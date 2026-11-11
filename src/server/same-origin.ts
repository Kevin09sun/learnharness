/**
 * Trusted same-origin browser intent for mutating routes — not user
 * authentication. In the desktop build every /api request carries the
 * per-launch capability header (electron/desktop-api.cjs), so that check
 * applies; in the browser build the supplied Origin must match the
 * addressed Host and an explicit cross-site fetch is refused. Forwarded-
 * origin headers are never trusted. A public deployment needs its own
 * access gate.
 */
import { desktopAPIAuthorized } from "./desktop-access.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";

export function sameOriginAuthorized(request: Request): boolean {
	const desktop = process.env.LH_DESKTOP_SERVER === "1" || Boolean(process.env.LH_DESKTOP_API_SECRET);
	if (desktop) return desktopAPIAuthorized(request.headers);
	const origin = request.headers.get("origin");
	if (!origin || origin === "null") return false;
	try {
		// Next's standalone Request URL can use its internal hostname. Match
		// the actual addressed Host through the app's existing origin seam;
		// never trust forwarded-origin headers.
		return (
			origin === subscriptionRequestOrigin(request) &&
			(!request.headers.has("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin")
		);
	} catch {
		return false;
	}
}