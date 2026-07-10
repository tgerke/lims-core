import bwipjs from "bwip-js";

/**
 * 2D DataMatrix label as PNG (ADR-0004: bwip-js). DataMatrix over QR because
 * it is the healthcare/lab convention (tolerates tiny cryovial labels and is
 * what GS1 healthcare specifies).
 */
export function generateDataMatrixPng(text: string, scale = 4): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: "datamatrix",
    text,
    scale,
    paddingwidth: 2,
    paddingheight: 2,
  });
}
