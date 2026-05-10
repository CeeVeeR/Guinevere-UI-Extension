/**
 * Tavern Mobile theme — mobile-first AMOLED roleplay redesign for SillyTavern.
 *
 * Architecture mirrors `google-messages`:
 *   - Inject a single container (`#tavern-mobile-container`) before `#top-bar`.
 *   - Hide the original ST chrome (`#top-bar`, `#top-settings-holder`).
 *   - Detach every drawer pane from `#top-settings-holder`, re-attach inside
 *     this theme's settings modal so the full feature surface stays reachable.
 *   - On `disable()`, every detached node is restored exactly where it came
 *     from. The theme leaves no residue.
 *
 * Design principles: KISS/DRY/SOLID/YAGNI. One token source (style.css).
 * Each handler does one thing. No premature abstraction.
 */

import { eventSource, event_types, name1 } from "../../../../../../script.js";
import { user_avatar } from "../../../../../personas.js";
import { debounce } from "../../../../../utils.js";
import { debounce_timeout } from "../../../../../constants.js";

const HTML_CONTAINER = $("#tavern-mobile-container");
const BODY_CLASS = "tavern-mobile";

/**
 * Map: original drawer id (under #top-settings-holder) → drawer-content id.
 * Populated on `execute()`, consumed on `disable()` to put each pane back.
 * @type {Object<string, string>}
 */
const RELOCATED_DRAWERS = {};

/* Feature menu — mirrors the design's nested menu.
 * `key` references the wrapper `id` on a `.drawer` under #top-settings-holder;
 * `relocateDrawers()` keys RELOCATED_DRAWERS by that wrapper id. */
const MENU_ITEMS = [
	{ key: "drawer:rightNavHolder",             icon: "users",    label: "Cast",        sub: "characters in play" },
	{ key: "drawer:WI-SP-button",               icon: "archive",  label: "Lorebook",    sub: "world facts" },
	{ key: "drawer:persona-management-button",  icon: "user",     label: "Personas",    sub: "switch yourself" },
	{ key: "drawer:sys-settings-button",        icon: "plug",     label: "Connection",  sub: "API · model" },
	{ key: "drawer:advanced-formatting-button", icon: "wand",     label: "Formatting",  sub: "regex · macros" },
	{ key: "drawer:user-settings-button",       icon: "settings", label: "User",        sub: "preferences" },
	{ key: "drawer:ai-config-button",           icon: "sliders",  label: "Sampling",    sub: "temp · top-p" },
	{ key: "drawer:extensions-settings-button", icon: "bolt",     label: "Extensions",  sub: "third-party tools" },
	{ key: "drawer:backgrounds-button",         icon: "image",    label: "Background",  sub: "scene art" },
];

/* Inline-svg icons. Stroked, currentColor — match style.css token sizes. */
const ICONS = {
	users:    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M3 19a6 6 0 0 1 12 0 M16 11a3 3 0 1 0 0-6 M21 19a6 6 0 0 0-3-5",
	archive:  "M3 6h18v4H3z M5 10v10h14V10 M9 14h6",
	user:     "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21a8 8 0 0 1 16 0",
	plug:     "M9 4v6 M15 4v6 M7 10h10v3a5 5 0 0 1-10 0z M12 18v3",
	wand:     "M5 19l11-11 3 3-11 11z M14 6l3 3 M3 11l2-2 2 2-2 2z",
	settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M19 12l2-1.5-1-2.5-2.5.5-1.5-1.5.5-2.5L14 3l-2 1.5L10 3 8 4.5 8.5 7 7 8.5 4.5 8 3 10l1.5 2L3 14l1 2.5 2.5-.5L8 17.5 7.5 20 10 21l2-1.5L14 21l2-1.5-.5-2.5L17 15.5l2.5.5L21 14l-2-2z",
	sliders:  "M4 6h10 M18 6h2 M4 12h2 M10 12h10 M4 18h14 M18 18h2",
	bolt:     "M13 2L3 14h7l-1 8 10-12h-7z",
	image:    "M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4",
	chevron:  "M9 6l6 6-6 6",
	chevL:    "M15 6l-6 6 6 6",
	regen:    "M4 4v6h6 M20 20v-6h-6 M5 14a8 8 0 0 0 14 4 M19 10a8 8 0 0 0-14-4",
};

const profileDataDebounce = debounce(setProfile, debounce_timeout.quick);
const titleDataDebounce = debounce(setTitle, debounce_timeout.quick);

/* ──────────────────────────────────────────────────────────────────
 * Tiny helpers
 * ────────────────────────────────────────────────────────────────── */

function svgIcon(name, size = 16, stroke = 2) {
	const d = ICONS[name] || ICONS.chevron;
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
		stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

function setBodyMode(on) {
	$("body").toggleClass(BODY_CLASS, !!on);
}

function setProfile() {
	if (!name1 || !name1.length) return;
	const src = `User Avatars/${user_avatar}`;
	HTML_CONTAINER.find("#tavern-profile-img").attr("src", src);
}

function setTitle() {
	// Source of truth: the most-recently-rendered character name in the active chat.
	const char = $("#rm_button_selected_ch h2").text().trim() ||
		$(".mes:not([is_user='true']):last .ch_name .name_text").last().text().trim();
	const chatName = $("#chat_filename").val()?.trim();
	HTML_CONTAINER.find("#tavern-title").text(chatName || char || "conversation");
	HTML_CONTAINER.find("#tavern-subtitle").text(char ? `with ${char}` : "");
}

/* ──────────────────────────────────────────────────────────────────
 * Burger menu (nested RP tools grid)
 * ────────────────────────────────────────────────────────────────── */

function buildMenu() {
	const grid = HTML_CONTAINER.find(".tavern-menu-grid").empty();
	const visible = MENU_ITEMS.filter(item => {
		if (!item.key.startsWith("drawer:")) return true;
		return Boolean(RELOCATED_DRAWERS[item.key.slice("drawer:".length)]);
	});
	for (const item of visible) {
		const $btn = $(
			`<button type="button" class="tavern-menu-item" role="menuitem">
				<span class="tavern-menu-item-icon">${svgIcon(item.icon, 16, 2)}</span>
				<span class="tavern-menu-item-text">
					<span class="tavern-menu-item-label"></span>
					<span class="tavern-menu-item-sub"></span>
				</span>
			</button>`,
		);
		$btn.find(".tavern-menu-item-label").text(item.label);
		$btn.find(".tavern-menu-item-sub").text(item.sub);
		$btn.on("click", () => onMenuItem(item.key));
		grid.append($btn);
	}
}

function onMenuItem(key) {
	closeMenu();
	if (key.startsWith("drawer:")) {
		const id = key.slice("drawer:".length);
		showSettingsModal(id);
	}
}

function toggleMenu() {
	const open = HTML_CONTAINER.find("#tavern-menu").attr("aria-hidden") === "false";
	open ? closeMenu() : openMenu();
}

function openMenu() {
	HTML_CONTAINER.find("#tavern-menu").attr("aria-hidden", "false");
	HTML_CONTAINER.find("#tavern-burger").attr("aria-expanded", "true");
}

function closeMenu() {
	HTML_CONTAINER.find("#tavern-menu").attr("aria-hidden", "true");
	HTML_CONTAINER.find("#tavern-burger").attr("aria-expanded", "false");
}

/* ──────────────────────────────────────────────────────────────────
 * Settings modal — relocates ST drawers, restores them on disable.
 * ────────────────────────────────────────────────────────────────── */

function relocateDrawers() {
	const top = $("#top-settings-holder");
	if (!top.length) throw new Error("top-settings-holder not found");

	const tabs = HTML_CONTAINER.find("#tavern-settings-tabs").empty();
	const pane = HTML_CONTAINER.find("#tavern-settings-pane").empty();

	top.find(".drawer").each(function () {
		const $drawer = $(this);
		const drawerId = $drawer.attr("id") || "";
		const $toggle = $drawer.find(".drawer-toggle");
		const $content = $drawer.find(".drawer-content");
		if (!$toggle.length || !$content.length) return;

		// Ensure the content has an id so we can target it later.
		if (!$content.attr("id")) {
			$content.attr("id", `tm-relocated-${drawerId || Math.random().toString(36).slice(2)}`);
		}

		// Clone the toggle for the tab strip; original stays so ST keeps its hooks.
		const $tab = $toggle.clone();
		$tab.attr("data-target", $content.attr("id"));
		$tab.on("click", function () {
			activateTab($content.attr("id"));
		});
		tabs.append($tab);

		// Move the content. detach() preserves data + listeners.
		$content.detach().appendTo(pane);
		RELOCATED_DRAWERS[drawerId] = $content.attr("id");
	});

	// Default: first tab open.
	const first = tabs.find(".drawer-toggle").first();
	const firstTarget = first.attr("data-target");
	if (firstTarget) activateTab(firstTarget);
}

function activateTab(contentId) {
	const tabs = HTML_CONTAINER.find("#tavern-settings-tabs");
	const pane = HTML_CONTAINER.find("#tavern-settings-pane");
	tabs.find(".drawer-toggle").each(function () {
		const $t = $(this);
		const active = $t.attr("data-target") === contentId;
		$t.find(".inline-drawer-icon").toggleClass("openIcon", active).toggleClass("closedIcon", !active);
	});
	pane.children(".drawer-content").removeClass("is-active");
	pane.find(`#${CSS.escape(contentId)}`).addClass("is-active");
}

function showSettingsModal(drawerId) {
	HTML_CONTAINER.find("#tavern-settings-modal").attr("aria-hidden", "false");
	if (drawerId && RELOCATED_DRAWERS[drawerId]) {
		activateTab(RELOCATED_DRAWERS[drawerId]);
	}
}

function hideSettingsModal() {
	HTML_CONTAINER.find("#tavern-settings-modal").attr("aria-hidden", "true");
}

/* ──────────────────────────────────────────────────────────────────
 * Persona modal — drops below the profile button. Reuses ST's own
 * persona switcher events so the canonical state stays in `power_user`.
 * ────────────────────────────────────────────────────────────────── */

function buildPersonaList() {
	const list = HTML_CONTAINER.find("#tavern-persona-list").empty();
	const personaButtons = $("#user_avatar_block .avatar-container");
	if (!personaButtons.length) {
		list.append(`<li><div class="tavern-persona-item-text"><div class="tavern-persona-item-tag">No personas configured.</div></div></li>`);
		return;
	}
	personaButtons.each(function () {
		const $orig = $(this);
		const file = $orig.find(".avatar img").attr("src") || "";
		const personaName = $orig.attr("title") || $orig.find(".ch_name").text().trim() || file.split("/").pop();
		const isActive = $orig.find(".avatar.selected").length > 0 ||
			file.endsWith(user_avatar);
		const initials = (personaName || "?").split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();

		const $li = $(
			`<li>
				<button type="button" class="tavern-persona-item" role="option">
					${file ? `<img alt="" src="${file}">` : `<span class="tavern-persona-fallback"></span>`}
					<span class="tavern-persona-item-text">
						<span class="tavern-persona-item-name"></span>
						<span class="tavern-persona-item-tag"></span>
					</span>
				</button>
			</li>`,
		);
		$li.find(".tavern-persona-fallback").text(initials);
		$li.find(".tavern-persona-item-name").text(personaName);
		$li.find(".tavern-persona-item-tag").text(file.split("/").pop() || "");
		const $btn = $li.find(".tavern-persona-item");
		if (isActive) {
			$btn.attr("aria-selected", "true");
			$btn.append(`<span class="tavern-persona-active-dot" aria-hidden="true"></span>`);
		}
		$btn.on("click", () => {
			$orig.trigger("click");
			hidePersonaModal();
		});
		list.append($li);
	});
}

function togglePersonaModal() {
	const open = HTML_CONTAINER.find("#tavern-persona-modal").attr("aria-hidden") === "false";
	if (open) {
		hidePersonaModal();
	} else {
		buildPersonaList();
		HTML_CONTAINER.find("#tavern-persona-modal").attr("aria-hidden", "false");
	}
}

function hidePersonaModal() {
	HTML_CONTAINER.find("#tavern-persona-modal").attr("aria-hidden", "true");
}

/* ──────────────────────────────────────────────────────────────────
 * Lightbox — tap a non-user hero portrait to view the full image.
 * Animates in/out via CSS `.is-open`. ESC + backdrop click both close.
 * ────────────────────────────────────────────────────────────────── */

function openLightbox(src, alt) {
	const $lb = HTML_CONTAINER.find("#tavern-lightbox");
	const $img = HTML_CONTAINER.find("#tavern-lightbox-img");
	if (!src) return;
	$img.attr("src", src);
	$img.attr("alt", alt || "");
	$lb.attr("aria-hidden", "false");
	// Defer the class so the transition has a starting state to interpolate from.
	requestAnimationFrame(() => $lb.addClass("is-open"));
}

function closeLightbox() {
	const $lb = HTML_CONTAINER.find("#tavern-lightbox");
	$lb.removeClass("is-open");
	$lb.attr("aria-hidden", "true");
	// Clear src after the fade so we don't flash the previous image next open.
	window.setTimeout(() => HTML_CONTAINER.find("#tavern-lightbox-img").attr("src", ""), 220);
}

function onPortraitTap(e) {
	const $mes = $(e.currentTarget).closest(".mes");
	if (!$mes.length) return;
	// User-message banners are claimed by the persona switcher.
	if ($mes.attr("is_user") === "true") return;
	const src = $mes.find(".avatar img").attr("src");
	const alt = $mes.find(".ch_name .name_text").text() || "Portrait";
	e.stopPropagation();
	openLightbox(src, alt);
}

/* ──────────────────────────────────────────────────────────────────
 * Generation state — show/hide the floating Stop button.
 * ────────────────────────────────────────────────────────────────── */

function setGenerating(on) {
	HTML_CONTAINER.find("#tavern-stop").prop("hidden", !on);
}

function onStopClick() {
	// Delegate to ST's native stop control. Falls back to clicking #mes_stop.
	const $stop = $("#mes_stop");
	if ($stop.length) $stop.trigger("click");
	setGenerating(false);
}

/* ──────────────────────────────────────────────────────────────────
 * Inline action chips on the last AI message + numbered choices.
 * Re-applied every render — cheap and idempotent.
 * ────────────────────────────────────────────────────────────────── */

const CHOICE_REGEX = /^\s*(?:(\d+)[.)]|[-•])\s+(.+)$/;

function decorateLastAiMessage() {
	const $chat = $("#chat");
	if (!$chat.length) return;
	const $last = $chat.find(".mes").last();
	if (!$last.length || $last.attr("is_user") === "true") return;

	// Remove decorations from prior turns so only the latest carries them.
	$chat.find(".tavern-inline-actions, .tavern-choices").remove();

	addInlineActions($last);
	addChoices($last);
}

function addInlineActions($mes) {
	if ($mes.find(".tavern-inline-actions").length) return;
	const $row = $(
		`<div class="tavern-inline-actions" role="group" aria-label="Reply actions">
			<button class="tavern-chip tavern-chip--primary" data-action="continue">
				${svgIcon("chevron", 14, 2.4)}<span>Continue</span>
			</button>
			<button class="tavern-chip" data-action="regen">
				${svgIcon("regen", 14, 2)}<span>Regenerate</span>
			</button>
		</div>`,
	);
	$row.find('[data-action="continue"]').on("click", () => triggerSlash("/continue"));
	$row.find('[data-action="regen"]').on("click", () => $mes.find(".mes_button.regenerate_mes_button").trigger("click"));

	const $swipes = $mes.find(".swipes-counter");
	if ($swipes.length && $swipes.text().trim()) {
		const total = $swipes.text().trim();
		const $stepper = $(
			`<div class="tavern-branch-stepper" role="group" aria-label="Branch">
				<button data-action="prev" aria-label="Previous">${svgIcon("chevL", 14, 2.2)}</button>
				<span class="tavern-branch-stepper-count"></span>
				<button data-action="next" aria-label="Next">${svgIcon("chevron", 14, 2.2)}</button>
			</div>`,
		);
		$stepper.find(".tavern-branch-stepper-count").text(total);
		$stepper.find('[data-action="prev"]').on("click", () => $mes.find(".swipe_left").trigger("click"));
		$stepper.find('[data-action="next"]').on("click", () => $mes.find(".swipe_right").trigger("click"));
		$row.append($stepper);
	}
	$mes.append($row);
}

/**
 * Parse the trailing run of `1.` / `2.` / `-` lines from an AI reply.
 * Returns [{num, text}] when 2-4 contiguous choices are present, else [].
 */
function extractChoices($mes) {
	const text = ($mes.find(".mes_text").text() || "").trim();
	if (!text) return [];
	const lines = text.split(/\r?\n/);
	const trailing = [];
	for (let i = lines.length - 1; i >= 0; i--) {
		const m = lines[i].match(CHOICE_REGEX);
		if (m) {
			trailing.unshift({ num: m[1] ? Number(m[1]) : trailing.length + 1, text: m[2].trim() });
			continue;
		}
		if (lines[i].trim() === "" && trailing.length === 0) continue;
		break;
	}
	return trailing.length >= 2 && trailing.length <= 4 ? trailing : [];
}

function addChoices($mes) {
	const choices = extractChoices($mes);
	if (!choices.length) return;
	const $box = $(`<div class="tavern-choices" role="group" aria-label="Quick reply choices">
		<div class="tavern-choices-eyebrow">Tap to reply</div>
	</div>`);
	for (const c of choices) {
		const $btn = $(
			`<button type="button" class="tavern-choice">
				<span class="tavern-choice-num"></span>
				<span class="tavern-choice-text"></span>
			</button>`,
		);
		$btn.find(".tavern-choice-num").text(String(c.num));
		$btn.find(".tavern-choice-text").text(c.text);
		$btn.on("click", () => sendUserText(c.text));
		$box.append($btn);
	}
	$mes.append($box);
}

function sendUserText(text) {
	const $ta = $("#send_textarea");
	if (!$ta.length) return;
	$ta.val(text).trigger("input");
	$("#send_but").trigger("click");
}

function triggerSlash(cmd) {
	const $ta = $("#send_textarea");
	if (!$ta.length) return;
	$ta.val(cmd).trigger("input");
	$("#send_but").trigger("click");
}

/* ──────────────────────────────────────────────────────────────────
 * Theme lifecycle
 * ────────────────────────────────────────────────────────────────── */

export async function execute() {
	try {
		const top = $("#top-settings-holder");
		if (!top.length) throw new Error("Failed to find top-settings-holder.");

		// Inject mode flag last — keeps the injection itself idempotent.
		setBodyMode(true);

		// Mount: theme container is already in DOM via Guinevere injection.
		// Wire static handlers.
		HTML_CONTAINER.find("#tavern-burger").on("click", toggleMenu);
		HTML_CONTAINER.find("#tavern-back").on("click", () => $("#leftNavDrawerIcon").trigger("click"));
		HTML_CONTAINER.find("#tavern-profile").on("click", togglePersonaModal);

		// Delegated: tap a user-message hero portrait → open persona switcher.
		$(document).on("click.tavernMobile", `.${BODY_CLASS} .mes[is_user="true"] .mesAvatarWrapper`, (e) => {
			e.stopPropagation();
			togglePersonaModal();
		});
		// Delegated: tap any character hero portrait → open the lightbox.
		$(document).on("click.tavernMobile", `.${BODY_CLASS} .mes:not([is_user="true"]) .mesAvatarWrapper`, onPortraitTap);
		// Lightbox dismissal — backdrop, close button, and ESC.
		HTML_CONTAINER.find("#tavern-lightbox").on("click", (e) => {
			if (e.target === e.currentTarget || $(e.target).closest("#tavern-lightbox-close").length) {
				closeLightbox();
			}
		});
		$(document).on("keydown.tavernMobile", (e) => {
			if (e.key === "Escape" && HTML_CONTAINER.find("#tavern-lightbox").hasClass("is-open")) {
				closeLightbox();
			}
		});
		HTML_CONTAINER.find("#tavern-persona-manage").on("click", () => {
			hidePersonaModal();
			showSettingsModal(RELOCATED_DRAWERS["user-settings-block"] ? "user-settings-block" : null);
		});
		HTML_CONTAINER.find("#tavern-settings-close").on("click", hideSettingsModal);
		HTML_CONTAINER.find("#tavern-stop").on("click", onStopClick);

		// Click on backdrop closes the modal.
		HTML_CONTAINER.find("#tavern-settings-modal").on("click", (e) => {
			if (e.target === e.currentTarget) hideSettingsModal();
		});
		HTML_CONTAINER.find("#tavern-persona-modal").on("click", (e) => {
			if (e.target === e.currentTarget) hidePersonaModal();
		});

		// Order matters: relocate first so buildMenu can filter to drawers
		// that actually live under #top-settings-holder in this ST build.
		relocateDrawers();
		buildMenu();

		// Initial state.
		setProfile();
		setTitle();
		decorateLastAiMessage();

		// React to ST events.
		eventSource.on(event_types.SETTINGS_UPDATED, profileDataDebounce);
		eventSource.on(event_types.CHAT_CHANGED, titleDataDebounce);
		eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, decorateLastAiMessage);
		eventSource.on(event_types.MESSAGE_DELETED, decorateLastAiMessage);
		eventSource.on(event_types.MESSAGE_SWIPED, decorateLastAiMessage);
		eventSource.on(event_types.GENERATION_STARTED, () => setGenerating(true));
		eventSource.on(event_types.GENERATION_ENDED, () => setGenerating(false));
		eventSource.on(event_types.GENERATION_STOPPED, () => setGenerating(false));

		// Hide native chrome.
		top.css("display", "none");
		$("#top-bar").css("display", "none");

		console.log("[tavern-mobile] theme loaded");
	} catch (error) {
		setBodyMode(false);
		throw new Error(`tavern-mobile: ${error.message}`);
	}
}

export function disable() {
	const top = $("#top-settings-holder");
	const pane = HTML_CONTAINER.find("#tavern-settings-pane");

	// Restore every relocated drawer-content node into its original drawer.
	for (const [drawerId, contentId] of Object.entries(RELOCATED_DRAWERS)) {
		const $content = pane.find(`#${CSS.escape(contentId)}`);
		const $home = top.find(`#${CSS.escape(drawerId)}`);
		if ($content.length && $home.length) {
			$content.removeClass("is-active");
			$content.attr("style", "");
			$content.detach().appendTo($home);
		}
	}
	for (const k of Object.keys(RELOCATED_DRAWERS)) delete RELOCATED_DRAWERS[k];

	// Detach ST event listeners we registered.
	eventSource.removeListener?.(event_types.SETTINGS_UPDATED, profileDataDebounce);
	eventSource.removeListener?.(event_types.CHAT_CHANGED, titleDataDebounce);
	eventSource.removeListener?.(event_types.CHARACTER_MESSAGE_RENDERED, decorateLastAiMessage);
	eventSource.removeListener?.(event_types.MESSAGE_DELETED, decorateLastAiMessage);
	eventSource.removeListener?.(event_types.MESSAGE_SWIPED, decorateLastAiMessage);

	// Drop any delegated handlers we registered under the .tavernMobile namespace.
	$(document).off(".tavernMobile");

	// Strip injected decorations from chat.
	$("#chat").find(".tavern-inline-actions, .tavern-choices").remove();

	// Reveal the original chrome.
	top.css("display", "");
	$("#top-bar").css("display", "");

	setBodyMode(false);
}
