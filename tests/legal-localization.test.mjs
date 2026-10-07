import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const legalPages = ["app/(legal)/privacy/page.tsx", "app/(legal)/terms/page.tsx"];

function parseTsx(path) {
  return ts.createSourceFile(path, fs.readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

test("privacy and terms copy stays localized and has Spanish dictionary entries", () => {
  const provider = parseTsx("app/components/LanguageProvider.tsx");
  const translations = new Set();
  const collectTranslations = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) translations.add(node.name.text);
    ts.forEachChild(node, collectTranslations);
  };
  collectTranslations(provider);

  for (const path of legalPages) {
    const source = parseTsx(path);
    let localizedBlocks = 0;

    const visit = (node) => {
      if (ts.isJsxElement(node)) {
        const tag = ts.isIdentifier(node.openingElement.tagName) ? node.openingElement.tagName.text : "";
        if (["p", "h1", "h2"].includes(tag)) {
          const meaningfulChildren = node.children.filter((child) => !ts.isJsxText(child) || child.getText(source).trim());
          assert.equal(meaningfulChildren.length, 1, `${path}: <${tag}> should have a single localized child`);
          const child = meaningfulChildren[0];
          assert.ok(ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child), `${path}: <${tag}> text must use LocalizedText`);
          const openingElement = ts.isJsxElement(child) ? child.openingElement : child;
          assert.equal(openingElement.tagName.getText(source), "LocalizedText", `${path}: <${tag}> text must use LocalizedText`);
          const textAttribute = openingElement.attributes.properties.find((attribute) =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "text",
          );
          assert.ok(textAttribute && ts.isJsxAttribute(textAttribute) && ts.isStringLiteral(textAttribute.initializer), `${path}: LocalizedText needs a static source string`);
          assert.ok(translations.has(textAttribute.initializer.text), `${path}: missing Spanish translation for ${textAttribute.initializer.text}`);
          localizedBlocks += 1;
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
    assert.ok(localizedBlocks > 0, `${path}: expected to audit legal text blocks`);
  }
});
