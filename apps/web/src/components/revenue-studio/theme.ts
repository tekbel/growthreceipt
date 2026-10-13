// AG Studio theme built from the app tokens in globals.css, so light and dark follow the app.

import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

// Revenue first in the accent color, then the status colors.
const chartColors = ["accent", "success", "warning", "ink-soft", "danger", "muted"];
const palette = Object.fromEntries(
  chartColors.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, token(color)],
    [`chartPaletteStrokes${i + 1}Color`, token(color)],
  ]),
);

export const revenueStudioTheme = studioTheme.withParams({
  fontFamily: "inherit",
  fontSize: 14,
  textColor: token("ink"),
  foregroundColor: token("ink"),
  subtleTextColor: token("muted"),
  backgroundColor: token("surface"),
  borderColor: token("line"),
  accentColor: token("accent"),
  iconColor: token("ink-soft"),
  rowHoverColor: token("surface-hover"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("stage"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("stage"),
  studioCanvasPadding: 8,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: "inherit",

  studioWidgetBackgroundColor: token("surface"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: "inherit",
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token("ink"),
  studioWidgetSubtitleFontFamily: "inherit",
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: "inherit",
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("accent"),

  studioPanelContainerBackgroundColor: token("surface"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("accent"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: "inherit",
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("surface-hover"),
  studioPanelChevronButtonHoverColor: token("accent"),
  studioToggleButtonActiveBackgroundColor: token("accent-soft"),
  studioToggleButtonActiveBorderColor: token("accent"),
  studioToggleButtonActiveColor: token("accent-strong"),

  gridFontFamily: "inherit",
  gridFontSize: 14,
  gridCellTextColor: token("ink"),
  gridHeaderBackgroundColor: token("surface-subtle"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: token("surface-hover"),
  gridWrapperBorder: false,

  chartFontFamily: "inherit",
  chartTextColor: token("ink"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("line"),
  chartGridLineColor: token("line"),
  ...palette,
});
