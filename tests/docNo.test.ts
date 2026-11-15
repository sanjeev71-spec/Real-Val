import { describe, expect, it } from "vitest";
import { lineDocNo, splitDocNo, validDocBase } from "../src/lib/docNo";

describe("Exp document numbers", () => {
  it("splits BASE-NN into document and line", () => {
    expect(splitDocNo("NOC-0419-07")).toEqual({ base: "NOC-0419", line: 7 });
    expect(splitDocNo("NOC-Missing-01")).toEqual({ base: "NOC-Missing", line: 1 });
    expect(splitDocNo("Sac-9999-99A")).toEqual({ base: "Sac-9999", line: 99 });
    expect(splitDocNo("BL-9999DL99-99")).toEqual({ base: "BL-9999DL99", line: 99 });
  });
  it("keeps one-dash numbers whole", () => {
    expect(splitDocNo("Sac-1860")).toEqual({ base: "Sac-1860", line: null });
    expect(splitDocNo("Chq-00042")).toEqual({ base: "Chq-00042", line: null });
    expect(splitDocNo("RP00001")).toEqual({ base: "RP00001", line: null });
    expect(splitDocNo(null)).toEqual({ base: null, line: null });
  });
  it("builds line numbers and checks typed bases", () => {
    expect(lineDocNo("NOC-0419", 3)).toBe("NOC-0419-03");
    expect(validDocBase("NOC-0419")).toBe(true);
    expect(validDocBase("bad number")).toBe(false);
    expect(validDocBase("x")).toBe(false);
  });
});
