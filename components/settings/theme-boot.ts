/** Server-importable: the root layout inlines THEME_BOOT_SCRIPT, and a value
 *  exported from a "use client" module would reach it as a client reference. */

/** Remembers the mode per browser so the next load paints it immediately. */
export const THEME_STORAGE_KEY = "lh-theme";

/** Runs before first paint. The server always renders class="dark"; only a
 *  remembered light mode changes it. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="light"){var c=document.documentElement.classList;c.remove("dark");c.add("light")}}catch(e){}`;
