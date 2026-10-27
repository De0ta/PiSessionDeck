import { Theme, type ThemeBg, type ThemeColor } from "@earendil-works/pi-coding-agent";

// Deliberately explicit test palette, not an application theme. Exercise Pi's real
// semantic-token renderer instead of passing strings to the concrete-color API.
export const foregrounds = {
  text: "#dadada", muted: "#929292", dim: "#777777", borderMuted: "#555555",
  accent: "#75b5ff", error: "#ee9696", success: "#a7d58e", warning: "#dbbd82",
  mdHeading: "#dbbd82", mdCode: "#8dcbb7", mdLink: "#75b5ff",
  syntaxKeyword: "#c3a2df", syntaxType: "#acb9ec", syntaxString: "#a7d58e",
  thinkingOff: "#929292", thinkingMinimal: "#8dcbb7", thinkingLow: "#a7d58e",
  thinkingMedium: "#dbbd82", thinkingHigh: "#d8a0b5", thinkingXhigh: "#c3a2df", thinkingMax: "#ee9696",
};
export const backgrounds = { selectedBg: "#659ee8", userMessageBg: "#444444", customMessageBg: "#262626" };
export function testTheme(fg: Partial<Record<ThemeColor, string | number>> = {}, bg: Partial<Record<ThemeBg, string | number>> = {}, mode: "truecolor" | "256color" = "truecolor"): Theme {
  return new Theme({ ...foregrounds, ...fg } as Record<ThemeColor, string | number>,
    { ...backgrounds, ...bg } as Record<ThemeBg, string | number>, mode);
}
export const theme = testTheme();
