import { describe, expect, it } from "vitest";
import { blank, fieldLabel, issuesByPath } from "./BodyEditor";

// The landing editor's form helpers (the landing CMS, part 3).

describe("the landing editor's form", () => {
  it("adds a list item shaped like the built-in text's, with no icon", () => {
    expect(blank({ icon: "users", title: "T", text: "X", items: ["a"], seconds: 5 })).toEqual({ title: "", text: "", items: [], seconds: 0 });
    expect(blank("text")).toBe("");
  });

  it("shows FastAPI's messages by field, without pydantic's branch names", () => {
    const issues = issuesByPath([
      { loc: ["cards", 0, "title"], msg: "String should have at least 1 character" },
      { loc: ["view_all", "href"], msg: "Value error, A link must be a site path (/apply)." },
      { loc: ["cards", 1, "icon", "literal['users','shield']"], msg: "Input should be 'users' or 'shield'" },
      { loc: [], msg: "Extra inputs are not permitted" },
    ]);
    expect(issues).toEqual({
      "cards.0.title": ["String should have at least 1 character"],
      "view_all.href": ["A link must be a site path (/apply)."],
      "cards.1.icon": ["Input should be 'users' or 'shield'"],
      "": ["Extra inputs are not permitted"],
    });
    expect(issuesByPath(undefined)).toEqual({});
  });

  it("names fields in words", () => {
    expect(fieldLabel("q")).toBe("Question");
    expect(fieldLabel("requirements_title")).toBe("Requirements title");
  });
});
