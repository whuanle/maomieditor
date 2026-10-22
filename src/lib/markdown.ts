export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }

  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/);

  if (!frontmatterMatch) {
    return content;
  }

  return content.slice(frontmatterMatch[0].length).replace(/^\r?\n/, "");
}
