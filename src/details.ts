import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, parseColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type MarkdownTheme } from "@earendil-works/pi-tui";
import { safeText, sessionColor, sessionTitle, type Preview } from "./model.ts";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export const COLORS = { bg: "#0c0c0c", text: "#dadada", white: "#ffffff", dim: "#929292", border: "#555555", selected: "#659ee8", ink: "#101820", error: "#ee9696", search: "#444444", blue: "#75b5ff", provider: "#8dcbb7", green: "#a7d58e" } as const;
export type Ink = `#${string}`;
export type Paint = (text: string, color?: Ink, bold?: boolean) => string;
export function painter(theme: Pick<Theme, "style">): Paint {
  return (text, color = COLORS.text, bold = false) => theme.style(text, { fg: parseColor(color), bold });
}
export function reasoningColor(level: string): Ink {
  return ({ off: COLORS.dim, minimal: "#8dcbb7", low: "#a7d58e", medium: "#dbbd82", high: "#d8a0b5", xhigh: "#c3a2df", max: "#ee9696" } as Record<string, Ink>)[level] ?? COLORS.dim;
}
function fallbackMarkdown(paint: Paint): MarkdownTheme {
  const dim = (text: string) => paint(text, COLORS.dim);
  return { heading: (text) => paint(text, "#dbbd82", true), link: (text) => paint(text, COLORS.blue), linkUrl: dim,
    code: (text) => paint(text, COLORS.provider), codeBlock: (text) => paint(text, COLORS.provider), codeBlockBorder: dim,
    quote: dim, quoteBorder: dim, hr: dim, listBullet: dim, bold: (text) => paint(text, COLORS.white, true),
    italic: (text) => text, strikethrough: (text) => text, underline: (text) => text };
}
/** Ellipsis is an independently styled fragment, never inherits title/Markdown colors. */
export function limitLines(lines: string[], count: number, width: number, paint: Paint): string[] {
  if (count <= 0) return [];
  if (lines.length <= count) return lines;
  const result = lines.slice(0, count);
  const suffix = ".".repeat(Math.min(3, width));
  result[count - 1] = truncateToWidth(result[count - 1]!, Math.max(0, width - visibleWidth(suffix)), "") + paint(suffix, COLORS.dim);
  return result;
}
export interface DetailLayout {
  session: SessionInfo; preview: Preview; status: string; current: boolean;
  width: number; height: number; offset: number; paint: Paint; markdownTheme?: MarkdownTheme;
}
/** Bounded viewport: prompt stays pinned while Shift+arrows scroll only the reply. */
export function detailLines(o: DetailLayout): { lines: string[]; maxOffset: number } {
  const { width, height, paint, session, preview } = o;
  if (height < 1) return { lines: [], maxOffset: 0 };
  const wrap = (text: string) => wrapTextWithAnsi(safeText(text, true), Math.max(1, width));
  const title = limitLines(wrap(sessionTitle(session)).map((line) => paint(line, sessionColor(session.id), true)), Math.min(3, Math.max(1, height - 11)), width, paint);
  const model = preview.details?.model ?? "Unknown";
  const slash = model.indexOf("/");
  const modelLine = paint("Model: ", COLORS.dim) + (slash < 0 ? paint(model, COLORS.blue) : paint(model.slice(0, slash), COLORS.provider) + paint("/", COLORS.dim) + paint(model.slice(slash + 1), COLORS.blue));
  const level = preview.details?.reasoning ?? "Not recorded";
  let meta = [...title, paint(`${o.status}${o.current ? " · Current" : ""}`, COLORS.dim), "", modelLine,
    paint("Reasoning: ", COLORS.dim) + paint(level, reasoningColor(level)),
    paint("Project: ", COLORS.dim) + paint(safeText(session.cwd)), ""];
  const maxMeta = Math.max(0, height - 6);
  if (meta.length > maxMeta) meta = meta.filter((line) => line !== "");
  if (meta.length > maxMeta) meta = meta.slice(0, maxMeta);
  const renderMarkdown = (text: string) => {
    const source = safeText(text, true).slice(0, 6000);
    return new Markdown(source, 0, 0, o.markdownTheme ?? fallbackMarkdown(paint), { color: (s) => paint(s) }).render(Math.max(1, width));
  };
  const reply = renderMarkdown(preview.details?.lastMessage ?? preview.note ?? "No reply yet");
  const prompt = renderMarkdown(preview.details?.prompt ?? "Not recorded");
  // Two labels + a spacer. Reserve at least two prompt rows on usable screens.
  const spacer = height >= 6 ? [""] : [];
  const budget = Math.max(0, height - meta.length - 2 - spacer.length);
  const promptBudget = Math.min(Math.max(2, Math.floor(budget * 0.4)), Math.max(0, budget - 1));
  const replyBudget = Math.max(0, budget - promptBudget);
  const maxOffset = Math.max(0, reply.length - Math.max(1, replyBudget));
  const offset = Math.min(Math.max(0, o.offset), maxOffset);
  const replyLines = limitLines(reply.slice(offset), replyBudget, width, paint);
  const promptLines = limitLines(prompt, promptBudget, width, paint);
  while (promptLines.length < Math.min(2, promptBudget)) promptLines.push("");
  return { lines: [...meta, paint("Last message", COLORS.dim), ...replyLines, ...spacer, paint("Prompt", COLORS.dim), ...promptLines].slice(0, height), maxOffset };
}
