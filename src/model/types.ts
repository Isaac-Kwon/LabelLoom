// LabelLoom project schema. All lengths are millimetres unless noted.
export const SCHEMA_VERSION = 1;

export type ObjType = 'text' | 'rect' | 'ellipse' | 'triangle' | 'line' | 'barcode' | 'qr' | 'image' | 'svg' | 'table';

export interface GradientStop { offset: number; color: string }
export type Fill =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: GradientStop[] }
  | { type: 'radial'; stops: GradientStop[] };

export interface Shadow { dx: number; dy: number; blur: number; color: string; opacity: number }
export interface Outline { width: number; color: string; double: boolean; width2: number; color2: string }
export interface Effects { shadow?: Shadow; outline?: Outline }

export type RuleOp = 'eq' | 'neq' | 'contains' | 'empty' | 'notEmpty' | 'hangul' | 'latin' | 'longer';

export interface StyleRule {
  /** column to test; empty string = this object's own resolved content */
  column: string;
  op: RuleOp;
  value: string;
  set: {
    hidden?: boolean;
    color?: string; // text color / barcode color / shape fill
    stroke?: string;
    fontSize?: number;
    text?: string;
  };
}

interface Base {
  id: string;
  type: ObjType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees, around box centre
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /** a guide for artwork already on the stock: shown in the editor, never printed */
  noPrint?: boolean;
  groupId?: string;
  rules: StyleRule[];
  hideIfEmpty: boolean;
}

export type TextFit = 'none' | 'shrink' | 'stretch';

export interface TextObj extends Base {
  type: 'text';
  content: string; // template, e.g. "{{이름}}"
  fontFamily: string;
  fontSize: number; // pt
  minFontSize: number; // pt, for shrink
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  multiline: boolean;
  fit: TextFit;
  letterSpacing: number; // mm
  lineHeight: number; // multiple of font size
  ellipsis: boolean;
  /** bend of the baseline in % (−100…100, 100 = half circle upward); 0 = straight */
  curve?: number;
  fill: Fill;
  effects: Effects;
}

export interface ShapeObj extends Base {
  type: 'rect' | 'ellipse' | 'triangle' | 'line';
  fill: Fill;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  dash: boolean;
  effects: Effects;
}

export interface BarcodeObj extends Base {
  type: 'barcode';
  content: string;
  symbology: string; // bwip-js bcid
  showText: boolean;
  textSize: number; // pt
  color: string;
  background: string; // '' = transparent
  keepAspect: boolean;
}

export interface QrObj extends Base {
  type: 'qr';
  content: string;
  symbology: 'qrcode' | 'datamatrix' | 'gs1datamatrix' | 'azteccode' | 'pdf417' | 'maxicode' | 'gs1qrcode';
  errorLevel: 'L' | 'M' | 'Q' | 'H';
  quietZone: number; // modules
  color: string;
  background: string;
  logo?: string; // data url
  logoScale: number; // 0..0.35 of box
}

export interface ImageObj extends Base {
  type: 'image';
  src: string; // data url, or an http(s) url linked rather than embedded
  fit: 'contain' | 'cover' | 'stretch';
  /**
   * Picture per data row, e.g. "{{사진}}": the value is a file name in Project.images, a URL or a
   * data URL. Empty = always `src`.
   */
  content: string;
}

export interface SvgObj extends Base {
  type: 'svg';
  svg: string; // raw svg markup
  fit: 'contain' | 'stretch';
}

/** Per-cell overrides; key is "row,col". */
export interface TableCellStyle {
  fill?: string;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

/** Cell (r,c) spans rs rows and cs columns; the covered cells are not drawn. */
export interface TableMerge { r: number; c: number; rs: number; cs: number }

export interface TableObj extends Base {
  type: 'table';
  /** cells[row][col], each a template like text content */
  cells: string[][];
  /** relative weights, scaled to the box */
  colWidths: number[];
  rowHeights: number[];
  merges: TableMerge[];
  styles: Record<string, TableCellStyle>;
  fontFamily: string;
  fontSize: number; // pt, shrinks to fit each cell
  minFontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  padding: number; // mm
  fill: string; // cell background, '' = none
  headerRow: boolean;
  headerCol: boolean;
  headerFill: string;
  headerColor: string;
  borderColor: string;
  borderWidth: number;
  outerWidth: number;
}

export type LabelObject = TextObj | ShapeObj | BarcodeObj | QrObj | ImageObj | SvgObj | TableObj;

export interface Design {
  id: string;
  name: string;
  objects: LabelObject[];
  /** back side, used for duplex printing */
  back?: LabelObject[];
}

export interface DesignRule { column: string; op: RuleOp; value: string; designId: string }

/**
 * Artwork already printed on the label stock, such as the coloured frame of an index label
 * (견출지). Shown in the editor and previews as a guide, never printed.
 */
export interface Preprint {
  color: string;
  /** frame width from the label edge to the writable area */
  borderTop: number;
  borderBottom: number;
  borderSide: number;
  /** corner radius of the writable area */
  innerRadius: number;
  show: boolean;
}

export interface Paper {
  name: string;
  width: number;
  height: number;
  labelWidth: number;
  labelHeight: number;
  cornerRadius: number;
  cols: number;
  rows: number;
  marginLeft: number;
  marginTop: number;
  gapX: number;
  gapY: number;
  /** safe-area inset shown as a guide inside each label */
  safeMargin: number;
  bleed: number;
  dpi: number;
  background?: { src: string; fit: 'contain' | 'cover' | 'stretch'; opacity: number; print: boolean };
  labelColor: string;
  preprint?: Preprint;
}

export interface Calibration { offsetX: number; offsetY: number; scaleX: number; scaleY: number }

export interface Row {
  id: string;
  print: boolean;
  copies: number;
  printed?: string; // ISO timestamp of last output
  checkedIn?: string; // ISO timestamp of check-in at the desk
  values: Record<string, string>;
}

export interface DataTable { columns: string[]; rows: Row[] }

/** Table pulled from a URL (CSV · xlsx); io/remote.ts fetches it again and merges new rows. */
export interface DataSource {
  url: string;
  sheet?: string;
  headerRow: number; // 0-based
  trim: boolean;
  /** source header -> target column name ('' = skip) */
  mapping: Record<string, string>;
  copiesColumn?: string;
  /** column that matches fetched rows to existing ones ('' = compare whole rows) */
  key: string;
  /** seconds between automatic refreshes, 0 = only by hand */
  interval: number;
}

export interface EmbeddedFont { family: string; data: string /* base64 */; format: 'truetype' | 'opentype' | 'woff' | 'woff2' }

/** Duplex layout last used for this project, so quick print and other machines follow it. */
export interface DuplexSettings { mode: 'sheets' | 'fold'; mirror: 'cols' | 'rows'; foldDir: 'right' | 'below'; foldRotate: boolean }

export interface Project {
  app: 'labelloom';
  version: number;
  name: string;
  paper: Paper;
  designs: Design[];
  designRules: DesignRule[];
  fonts: EmbeddedFont[];
  /** pictures for image objects bound to a column: file name (or saved URL) → data url */
  images?: Record<string, string>;
  data: DataTable;
  dataSource?: DataSource;
  calibration: Calibration;
  seqStart: number;
  duplex?: DuplexSettings;
}
