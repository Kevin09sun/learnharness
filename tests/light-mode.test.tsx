/**
 * Light mode: the saved appearance mode actually changes the page. The
 * palette, the class swap, the pre-paint boot script, and the surfaces that
 * used to assume a dark page.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { applyThemeMode, derivedPalette, appearanceVars, resolveAppearance, THEME_BOOT_SCRIPT } from "../components/settings/appearance.tsx";
import { AppearanceSection } from "../components/settings/appearance-section.tsx";
import { confidenceRailStyle } from "../components/confidence-rail.tsx";
import { mermaidThemeForMode } from "../components/mermaid-render.ts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
	const start = css.search(new RegExp(`^\\${selector} \\{`, "m"));
	assert.ok(start >= 0, `${selector} block exists`);
	const body = css.slice(start, css.indexOf("\n}", start));
	return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+|color-scheme):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!]));
}

function fakeRoot(initial: string[]) {
	const classes = new Set(initial);
	return {
		classes,
		classList: {
			add: (name: string) => { classes.add(name); },
			remove: (name: string) => { classes.delete(name); },
		},
	};
}

/** WCAG relative-luminance contrast for #rrggbb. */
function contrast(a: string, b: string): number {
	const lum = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
	};
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi! + 0.05) / (lo! + 0.05);
}

describe("light palette", () => {
	it("defines every token the dark palette does", () => {
		const dark = block(".dark");
		const light = block(".light");
		for (const token of Object.keys(dark)) assert.ok(token in light, `${token} missing from .light`);
	});

	it("tells the browser the page is light", () => {
		assert.equal(block(".light")["color-scheme"], "light");
	});

	it("text stays readable on the page and on raised surfaces", () => {
		const t = block(".light");
		assert.ok(contrast(t["--foreground"]!, t["--background"]!) >= 7, "body text");
		assert.ok(contrast(t["--muted-foreground"]!, t["--background"]!) >= 4.5, "muted text on page");
		assert.ok(contrast(t["--muted-foreground"]!, t["--card"]!) >= 4.5, "muted text on cards");
		assert.ok(contrast(t["--background"]!, t["--foreground"]!) > 1, "page is lighter or darker than text");
		assert.ok(parseInt(t["--background"]!.slice(1, 3), 16) > 0xe0, "the page is actually light");
	});
});

describe("applyThemeMode", () => {
	it("light swaps the html class", () => {
		const root = fakeRoot(["dark", "font-var"]);
		applyThemeMode(root, "light");
		assert.deepEqual([...root.classes].sort(), ["font-var", "light"]);
	});

	it("dark swaps it back", () => {
		const root = fakeRoot(["light", "font-var"]);
		applyThemeMode(root, "dark");
		assert.deepEqual([...root.classes].sort(), ["dark", "font-var"]);
	});
});

describe("THEME_BOOT_SCRIPT (runs before first paint)", () => {
	function run(stored: string | null | Error) {
		const root = fakeRoot(["dark"]);
		const localStorage = { getItem: () => { if (stored instanceof Error) throw stored; return stored; } };
		new Function("document", "localStorage", THEME_BOOT_SCRIPT)({ documentElement: root }, localStorage);
		return [...root.classes];
	}
	it("applies a remembered light mode", () => assert.deepEqual(run("light"), ["light"]));
	it("leaves dark alone when nothing is remembered", () => assert.deepEqual(run(null), ["dark"]));
	it("ignores garbage values", () => assert.deepEqual(run("purple"), ["dark"]));
	it("survives blocked storage", () => assert.deepEqual(run(new Error("denied")), ["dark"]));
});

describe("custom background follows the mode", () => {
	it("light surfaces step darker than the page", () => {
		const p = derivedPalette("#ffffff", "light");
		assert.equal(p["--card"], "#f7f7f7");
		assert.equal(p["--accent"], "#e9e9e9");
		assert.equal(p["--border"], "#d0d0d0");
		assert.equal(p["--primary-foreground"], "#ffffff");
	});

	it("the provider's mapping passes the mode through", () => {
		const vars = appearanceVars(resolveAppearance({ mode: "light", background: "#ffffff" }));
		assert.equal(vars["--card"], "#f7f7f7");
	});
});

describe("surfaces that assumed a dark page", () => {
	it("the confidence rail's empty track follows the theme", () => {
		const style = confidenceRailStyle(50);
		assert.equal(style.backgroundColor, "var(--background)");
		assert.ok(!String(style.backgroundImage).includes("rgba(230,230,230"), "ticks are not fixed light grey");
	});

	it("diagrams use mermaid's light theme in light mode", () => {
		assert.equal(mermaidThemeForMode("light").theme, "default");
		assert.equal(mermaidThemeForMode("dark").theme, "dark");
	});
});

describe("Settings mode control", () => {
	const tag = (html: string, id: string) => html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

	it("is a live Dark/Light choice", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		assert.ok(!tag(html, "select-mode").includes("disabled"), "enabled");
		assert.ok(!tag(html, "row-mode").includes("opacity-40"), "not dimmed");
		assert.ok(!html.includes("Coming soon"));
		assert.match(html, /<option value="light"[^>]*>Light<\/option>/);
	});

	it("shows the saved mode", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={{ mode: "light" }} onSectionChange={() => {}} />);
		assert.match(html, /<option value="light" selected[^>]*>Light<\/option>/);
	});
});
