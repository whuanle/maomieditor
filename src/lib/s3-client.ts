import { createHash, createHmac } from "node:crypto";

/**
 * 最小 S3 兼容客户端（手写 SigV4 签名，零第三方依赖）：
 * 兼容 AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS(S3) / 腾讯云 COS(S3) 等任意
 * S3 兼容端点，统一走 path-style（{endpoint}/{bucket}/{key}）。
 * 只实现同步所需操作：ListObjectsV2 / PutObject / GetObject / DeleteObject / HeadBucket。
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3ObjectInfo {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
}

const SHA256_EMPTY = createHash("sha256").update("").digest("hex");

/** RFC3986 严格编码（encodeURIComponent 基础上补编 ! ' ( ) *）；导出供签名回归测试 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** S3 key → 规范化 URI 路径：按段编码、保留 / 分隔 */
function encodeKeyPath(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * SigV4 签名（导出供测试对照 AWS 官方测试向量）。
 * headers 需含全部待签头（含 host）；返回 Authorization 与规范化请求的哈希。
 */
export function sigv4Sign(input: {
  method: string;
  canonicalUri: string;
  canonicalQuery: string;
  headers: Record<string, string>;
  payloadHash: string;
  amzDate: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}): { authorization: string; canonicalRequestHash: string } {
  const signedHeaders = Object.keys(input.headers).sort().join(";");
  const canonicalHeaders = Object.keys(input.headers)
    .sort()
    .map((name) => `${name}:${input.headers[name].trim()}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    input.canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const canonicalRequestHash = sha256Hex(canonicalRequest);

  const dateStamp = input.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, canonicalRequestHash].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), input.service),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequestHash,
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? unescapeXml(match[1]) : null;
}

async function parseS3Error(response: Response): Promise<Error> {
  let detail = "";
  try {
    const xml = await response.text();
    const code = extractXmlTag(xml, "Code");
    const message = extractXmlTag(xml, "Message");
    if (code || message) {
      detail = `：${code ?? ""} ${message ?? ""}`.trim();
    }
  } catch {
    // 非 XML 响应体，忽略
  }
  return new Error(`S3 请求失败（HTTP ${response.status}${response.statusText ? " " + response.statusText : ""}）${detail}`);
}

export class S3Client {
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(config: S3Config) {
    // 端点去掉尾斜杠；缺协议时默认 https
    let endpoint = config.endpoint.trim().replace(/\/+$/, "");
    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      endpoint = `https://${endpoint}`;
    }
    this.endpoint = endpoint || "https://s3.amazonaws.com";
    this.region = config.region.trim() || "us-east-1";
    this.bucket = config.bucket.trim();
    this.accessKeyId = config.accessKeyId.trim();
    this.secretAccessKey = config.secretAccessKey;
  }

  /** 规范化端点（展示用） */
  describe(): string {
    return `${this.bucket} @ ${this.endpoint}`;
  }

  /**
   * 发起 SigV4 签名请求。key 是原始对象 key（不带桶），
   * query 是键值对数组。实际请求 URL 直接使用规范化查询串，
   * 保证服务端看到的查询与被签名内容逐字节一致。
   */
  private async request(
    method: "GET" | "PUT" | "DELETE" | "HEAD",
    key: string,
    query: [string, string][] = [],
    body?: Buffer,
    contentType?: string,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    const canonicalUri = `/${this.bucket}${key ? `/${encodeKeyPath(key)}` : ""}`;
    const sortedQuery = [...query].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const canonicalQuery = sortedQuery.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");
    const url = new URL(`${this.endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`);

    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const payloadHash = body ? sha256Hex(body) : SHA256_EMPTY;

    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(contentType ? { "content-type": contentType } : {}),
      ...(extraHeaders ?? {}),
    };
    const { authorization } = sigv4Sign({
      method,
      canonicalUri,
      canonicalQuery,
      headers,
      payloadHash,
      amzDate,
      region: this.region,
      service: "s3",
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
    });

    const fetchHeaders: Record<string, string> = { ...headers, authorization };
    delete fetchHeaders.host; // fetch 自带 Host
    return fetch(url, {
      method,
      headers: fetchHeaders,
      // Buffer 与 DOM BodyInit 类型定义不兼容（运行时就是合法 body）
      body: body ? (body as unknown as BodyInit) : undefined,
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  }

  /** 列出前缀下全部对象（自动翻页）。MaxKeys 交给服务端默认（多数为 1000）。 */
  async list(prefix: string): Promise<S3ObjectInfo[]> {
    const out: S3ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const query: [string, string][] = [["list-type", "2"]];
      if (prefix) {
        query.push(["prefix", prefix]);
      }
      if (token) {
        query.push(["continuation-token", token]);
      }
      const response = await this.request("GET", "", query);
      if (!response.ok) {
        throw await parseS3Error(response);
      }
      const xml = await response.text();
      const truncated = extractXmlTag(xml, "IsTruncated") === "true";
      token = truncated ? (extractXmlTag(xml, "NextContinuationToken") ?? undefined) : undefined;
      for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const section = block[1];
        const key = extractXmlTag(section, "Key");
        if (key === null) {
          continue;
        }
        out.push({
          key,
          size: Number(extractXmlTag(section, "Size") ?? "0"),
          etag: (extractXmlTag(section, "ETag") ?? "").replace(/^"|"$/g, ""),
          lastModified: extractXmlTag(section, "LastModified") ?? "",
        });
      }
    } while (token);
    return out;
  }

  /** 上传对象，返回服务端 ETag（去引号；单段 PUT 即内容 MD5） */
  async put(key: string, body: Buffer, contentType?: string): Promise<string> {
    const response = await this.request("PUT", key, [], body, contentType);
    if (!response.ok) {
      throw await parseS3Error(response);
    }
    return (response.headers.get("etag") ?? "").replace(/^"|"$/g, "");
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request("GET", key);
    if (!response.ok) {
      throw await parseS3Error(response);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.request("DELETE", key);
    if (!response.ok && response.status !== 404) {
      throw await parseS3Error(response);
    }
  }

  /** 连通性测试：列出 1 个对象即可证明 桶存在 + 凭据有效 + List 权限 */
  async test(): Promise<{ objectCount: number }> {
    const response = await this.request("GET", "", [
      ["list-type", "2"],
      ["max-keys", "1"],
    ]);
    if (!response.ok) {
      throw await parseS3Error(response);
    }
    const xml = await response.text();
    const count = Number(extractXmlTag(xml, "KeyCount") ?? "0");
    return { objectCount: count };
  }
}
