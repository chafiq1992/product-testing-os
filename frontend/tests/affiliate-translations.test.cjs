const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "lib/affiliate-translations.ts"),
  "utf8",
);
const result = {};
new Function(
  "exports",
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(result);
const { translate } = result;

test("French delivery-app states are localized in all workspace languages", () => {
  assert.equal(translate("Livré", "en"), "Delivered");
  assert.equal(translate("Livré", "fr"), "Livré");
  assert.equal(translate("Livré", "ar"), "تم التسليم");
  assert.equal(translate("Expédié (partenaire)", "en"), "Shipped by partner");
  assert.equal(translate("Annulé par vendeur", "ar"), "ألغاه البائع");
});

test("dynamic translations preserve seller names and receipt references", () => {
  assert.equal(
    translate("Welcome, Nour [test]", "fr"),
    "Bienvenue, Nour [test]",
  );
  assert.equal(translate("Welcome, نور", "ar"), "مرحبًا، نور");
  assert.equal(translate("View order #901", "fr"), "Voir la commande #901");
  assert.equal(translate("View order #901", "ar"), "عرض الطلب #901");
  assert.equal(
    translate(
      "Shopify rejected this order: order: Order tags is invalid",
      "ar",
    ),
    "رفض شوبيفاي هذا الطلب: order: Order tags is invalid",
  );
});

test("unknown customer/product data and whitespace are preserved", () => {
  for (const language of ["en", "fr", "ar"]) {
    assert.equal(
      translate("Blue / one size(2years to 10years)", language),
      "Blue / one size(2years to 10years)",
    );
    assert.equal(translate("Test street <123>", language), "Test street <123>");
  }
  assert.equal(translate(" Updated: ", "fr"), " Mis à jour : ");
  assert.equal(translate("   ", "ar"), "   ");
});

test("every static seller interface phrase has an Arabic translation", () => {
  const files = [
    "app/affiliates/page.tsx",
    "components/AffiliateCustomers.tsx",
    "components/AffiliateMarketplace.tsx",
    "components/AffiliateModal.tsx",
    "components/AffiliateOrderDetails.tsx",
    "components/AffiliateOrderEditor.tsx",
    "components/AffiliateReceipt.tsx",
    "components/AffiliatePayoutRequest.tsx",
    "lib/affiliate-locale.tsx",
  ];
  const missing = new Set();
  for (const file of files) {
    const ast = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(root, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function inspect(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        if (/[a-zA-Z]{2}/.test(key) && translate(key, "ar") === key)
          missing.add(key);
      }
      // Language names deliberately stay in their native language.
      if (
        ts.isJsxText(node) &&
        /[a-zA-Z]{2}/.test(node.text) &&
        !["English", "Français"].includes(node.text.trim())
      )
        missing.add(`Untranslated JSX: ${node.text.trim()}`);
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
  }
  assert.deepEqual([...missing], []);
});
