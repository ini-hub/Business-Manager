import { describe, it, expect } from "vitest";
import { parseInboundMessage } from "./WhatsAppBookingConversationEngine";

describe("parseInboundMessage", () => {
  it("extracts plain text body", () => {
    expect(parseInboundMessage({ type: "text", text: { body: "Hello" } })).toEqual({
      type: "text",
      text: "Hello",
    });
  });

  it("extracts a list reply id from an interactive message", () => {
    expect(parseInboundMessage({
      type: "interactive",
      interactive: { type: "list_reply", list_reply: { id: "svc:abc123", title: "Haircut" } },
    })).toEqual({ type: "interactive", interactiveReplyId: "svc:abc123" });
  });

  it("extracts a button reply id from an interactive message", () => {
    expect(parseInboundMessage({
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "confirm:yes", title: "Yes, book it" } },
    })).toEqual({ type: "interactive", interactiveReplyId: "confirm:yes" });
  });

  it("defaults to text type when Meta omits the type field", () => {
    expect(parseInboundMessage({ text: { body: "hi" } })).toEqual({ type: "text", text: "hi" });
  });

  it("returns no interactiveReplyId when neither list_reply nor button_reply is present", () => {
    expect(parseInboundMessage({ type: "interactive", interactive: {} })).toEqual({
      type: "interactive",
      interactiveReplyId: undefined,
    });
  });

  it("handles an unrecognized message type without throwing", () => {
    expect(parseInboundMessage({ type: "image" })).toEqual({ type: "image", text: undefined });
  });

  it("handles a completely empty payload without throwing", () => {
    expect(parseInboundMessage({})).toEqual({ type: "text", text: undefined });
  });
});
