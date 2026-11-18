// The panel's address rule (public/address.js) against the rule that every other client uses
// (iterate/mind-api `mindAddressOf`): the extension carries its own copy, and the two answer alike.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mindAddressOf } from "../../../core/lib/src/mind-api.ts";
import { mindIssuerOf } from "../public/address.js";

void test("what a person typed names the same mind in the panel as in every other client", () => {
  for (const typed of [
    "example.com",
    "  Example.COM.  ",
    // a control plane at a zone's apex, and at a hostname of the person's choice
    "https://example.com",
    "example.com/",
    "control.example.com",
    "iterate.example.com",
    "https://iterate.example.com/minds/x",
    "example.co.uk",
  ]) {
    const shared = mindAddressOf(typed);
    assert.ok("address" in shared, typed);
    assert.equal(mindIssuerOf(typed), `https://${shared.address}`, typed);
  }
  assert.equal(mindIssuerOf("https://example.com"), "https://example.com");
  assert.equal(mindIssuerOf("control.example.com"), "https://control.example.com");
});

void test("what is no address in the other clients is none in the panel", () => {
  for (const typed of ["", "example", "192.0.2.1", "https://[2001:db8::1]/", "foo_bar.com"]) {
    assert.ok("error" in mindAddressOf(typed), typed);
    assert.throws(() => mindIssuerOf(typed), typed);
  }
});
