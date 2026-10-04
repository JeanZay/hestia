import { describe,it,expect } from "vitest";
import { identityCrypto,newCodes } from "../../src/server/identity/crypto";

describe("identity secret domains",()=>{
  it("authenticates temporary ciphertext including its full context",()=>{
    const c=identityCrypto("Synthetic crypto only ".repeat(3));
    const sealed=c.seal({value:"synthetic"},"flow|generation|batch");
    expect(c.open(sealed,"flow|generation|batch")).toEqual({value:"synthetic"});
    expect(()=>c.open(sealed,"other-flow|generation|batch")).toThrow();
    expect(()=>identityCrypto("Other synthetic only ".repeat(3)).open(sealed,"flow|generation|batch")).toThrow();
    expect(c.digest("otp","same")===c.digest("browser","same")).toBe(false);
  });
  it("creates eight independently random 128-bit recovery secrets plus selectors",()=>{
    const codes=newCodes();expect(codes.length).toBe(8);expect(new Set(codes).size).toBe(8);
    expect(codes.every(code=>/^[0-9a-f]{12}(?:-[0-9a-f]{8}){4}$/.test(code))).toBe(true);
  });
});
