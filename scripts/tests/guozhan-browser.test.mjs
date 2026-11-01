import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NONAME_PLAYWRIGHT_PATH || "playwright");
const origin = process.env.NONAME_TEST_URL || "http://127.0.0.1:8081";
const output = process.env.NONAME_TEST_OUTPUT || "/tmp/noname-guozhan-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const reports = [];
try {
	for (const scenario of [
		{ mode: "guozhan", sub: "normal" },
		{ mode: "guozhan", sub: "jiubian" },
		{ mode: "identity", sub: "normal" },
	]) {
		if (process.env.NONAME_TEST_MODE && scenario.mode !== process.env.NONAME_TEST_MODE) continue;
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const page = await context.newPage();
		const errors = [];
		page.on("console", message => {
			if (message.text().startsWith("GUOZHAN_TEST")) console.log(message.text());
		});
		page.on("pageerror", error => errors.push(error.stack));
		page.on("dialog", async dialog => {
			errors.push(dialog.message());
			await dialog.dismiss();
		});
		await page.addInitScript(() => {
			localStorage.setItem("gplv3_noname_alerted", "true");
			localStorage.setItem("noname_0.9_loadtime", "120000");
		});
		await page.route("**/game/config.json", async route => {
			const response = await route.fetch();
			const config = await response.json();
			Object.assign(config, { mode: scenario.mode, version: "1.11.7", show_splash: "off", new_tutorial: true, cards: ["standard", "extra"], characters: ["standard"], debug: true, dev: true, animation: false, game_speed: "vvfast", volumn_audio: 0, volumn_background: 0, change_skin: false, right_range: false, show_favourite: false });
			config.mode_config[scenario.mode] = { ...config.mode_config[scenario.mode], player_number: 4, identity_mode: "normal", choice_num: 7, onlyguozhan: true, aozhan: "off", initshow_draw: "off", guozhan_mode: scenario.sub, auto_identity: "off", change_choice: false, free_choose: false };
			await route.fulfill({ response, json: config });
		});
		console.log(`Loading ${scenario.mode}/${scenario.sub}`);
		await page.goto(origin, { waitUntil: "domcontentloaded" });
		console.log("Document loaded");
		await page.evaluate(async () => {
			window.__engine = await import("/noname.js");
		});
		await page.waitForFunction(() => window.__engine?.game.players.length === 4, null, { timeout: 60000 });
		await page.waitForFunction(() => !!window.__engine.ui.menuContainer, null, { timeout: 15000 });
		console.log("Players initialized");
		await page.evaluate(() => {
			const { ui, _status } = window.__engine;
			if (!_status.auto) ui.click.auto();
		});
		await page.waitForFunction(() => window.__engine.game.phaseNumber > 0, null, { timeout: 60000 });
		await page.evaluate(() => {
			window.__engine.game.pause();
			window.__engine._status.paused3 = true;
		});
		console.log("Game started and paused");
		const report = await page.evaluate(({ mode, sub }) => {
			const { game, lib, ui, get, _status } = window.__engine;
			const check = (condition, message) => {
				if (!condition) throw new Error(message);
			};
			check(get.mode() === mode && game.phaseNumber > 0, "game failed to start");
			const names = mode === "guozhan" ? ["gz_caocao", "gz_guojia"] : ["caocao", "guojia"];
			const p = ui.create.player().init(...names);
			p.seatNum = 3;
			const originalMe = game.me;
			const originalCard = ui.click.charactercard;
			const calls = [];
			ui.click.charactercard = (...args) => calls.push(args);
			const profiles = dialog => Array.from(dialog.content.querySelectorAll(".pointerdiv")).filter(node => /^查看/.test(node.textContent));
			let cases = 0;
			if (mode === "guozhan") {
				check(_status.seatNumSettled && game.roundNumber > 0, "round tracking failed after early seat initialization");
				check(JSON.stringify(game.players.map(p => p.getSeatNum()).sort()) === "[1,2,3,4]", "natural startup did not assign seats");
				const seated = game.players.slice();
				const originalSeats = seated.map(p => p.getSeatNum());
				game.swapSeat(seated[0], seated[2], false);
				check(seated[0].getSeatNum() === originalSeats[2] && seated[2].getSeatNum() === originalSeats[0], "live swap did not update seats");
				for (const player of seated) {
					const seat = get.seatTranslation(player.getSeatNum() - 1);
					check(player.getName().startsWith(seat) && player.node.name_seat.textContent === seat, "live name and seat label diverged");
				}
				game.swapSeat(seated[0], seated[2], false);
				const oldMap = game.playerMap;
				game.playerMap = Object.fromEntries(seated.map(p => [p.dataset.position, p]));
				_status.video = true;
				game.videoContent.swapSeat([seated[0].dataset.position, seated[2].dataset.position]);
				check(seated[0].getSeatNum() === originalSeats[2] && seated[2].getSeatNum() === originalSeats[0], "replay swap did not update seats");
				game.videoContent.swapSeat([seated[0].dataset.position, seated[2].dataset.position]);
				_status.video = false;
				game.playerMap = oldMap;
				check(JSON.stringify(seated.map(p => p.getSeatNum())) === JSON.stringify(originalSeats), "seat swap restoration failed");
				for (const replay of [false, true])
					for (const observe of [false, true])
						for (const control of ["other", "self", "controlled"])
							for (let hidden = 0; hidden < 4; hidden++)
								for (const phone of [false, true])
									for (const simple of [false, true])
										for (let present = 0; present < 4; present++) {
											_status.video = replay;
											game.observe = observe;
											game.me = control === "self" ? p : originalMe;
											p._trueMe = control === "controlled" ? originalMe : undefined;
											lib.config.phonelayout = phone;
											game.layout = "mobile";
											p.name = hidden === 3 ? "unknown2" : names[hidden & 1 ? 1 : 0];
											p.name1 = present & 1 ? names[0] : undefined;
											p.name2 = present & 2 ? names[1] : undefined;
											for (const index of [0, 1]) {
												p.classList.toggle(index ? "unseen2" : "unseen", replay ? !(hidden & (1 << index)) : !!(hidden & (1 << index)));
												p.classList.toggle(index ? "unseen2_v" : "unseen_v", !!(hidden & (1 << index)));
											}
											const dialog = get.nodeintro(p, simple);
											const entries = profiles(dialog);
											const expected = [0, 1].filter(index => present & (1 << index) && (!simple || phone) && (!(hidden & (1 << index)) || (!replay && !observe && control !== "other")));
											const label = JSON.stringify({ replay, observe, control, hidden, phone, simple, present });
											check(JSON.stringify(entries.map(node => node.textContent)) === JSON.stringify(expected.map(index => (index ? "查看副将" : "查看主将"))), `profiles: ${label}`);
											check(dialog.content.firstElementChild.textContent.startsWith(p.getName()), `heading: ${label}`);
											const before = calls.length;
											entries.forEach((entry, i) => {
												entry.click();
												const index = expected[i];
												const call = calls.at(-1);
												check(call?.[0] === names[index] && call[4] === p.node[index ? "avatar2" : "avatar"], `profile target: ${label}`);
											});
											check(calls.length === before + expected.length, `click count: ${label}`);
											dialog.remove();
											cases++;
											if (cases % 96 === 0) console.log("GUOZHAN_TEST matrix", cases);
										}
				_status.video = false;
				game.observe = false;
				game.me = originalMe;
				p._trueMe = undefined;
				lib.config.phonelayout = false;
				p.name = p.name1 = names[0];
				p.name2 = names[1];
				p.classList.remove("unseen", "unseen2", "unseen_v", "unseen2_v");
				const dialog = get.nodeintro(p);
				const entries = profiles(dialog);
				let before = calls.length;
				p.classList.add("unseen");
				entries[0].click();
				check(calls.length === before, "opened menu leaked newly hidden main");
				p.name2 = "gz_simayi";
				p.skin.name2 = "gz_simayi";
				entries[1].click();
				check(calls.at(-1)[0] === "gz_simayi" && calls.at(-1)[5] === "gz_simayi", "opened menu retained stale deputy");
				delete p.name2;
				before = calls.length;
				entries[1].click();
				check(calls.length === before, "opened menu accessed missing deputy");
				dialog.remove();
				p.name2 = names[1];
				p.skin.name2 = names[1];
				p.classList.remove("unseen");
				p._customintro = ["custom heading", "custom body"];
				const custom = get.nodeintro(p);
				check(custom.content.firstElementChild.textContent === "custom heading" && profiles(custom).length === 0, "custom intro changed");
				custom.remove();
				delete p._customintro;
				const linked = ui.create.div();
				linked.linkplayer = true;
				linked.link = p;
				const linkedDialog = get.nodeintro(linked);
				check(linkedDialog.content.firstElementChild.textContent.startsWith(p.getName()) && profiles(linkedDialog).length === 2, "linked player intro failed");
				linkedDialog.remove();
				p._nointro = true;
				check(get.nodeintro(p) === undefined, "nointro ignored");
				delete p._nointro;
				lib.config.phonelayout = lib.config.touchscreen = true;
				_status.touchconfirmed = true;
				const touchDialog = get.nodeintro(p, true);
				const touchButtons = profiles(touchDialog);
				before = calls.length;
				touchButtons.forEach(button => button.dispatchEvent(new Event("touchend")));
				check(touchButtons.length === 2 && calls.length === before + 2, "touchscreen profile clicks failed");
				touchDialog.remove();
				lib.config.phonelayout = lib.config.touchscreen = false;
				delete _status.touchconfirmed;
				const restored = ui.create.player();
				restored.setModeState(JSON.parse(JSON.stringify(p.getState())));
				check(restored.getName() === p.getName(), "common snapshot did not preserve name and current seat");
				const replayPlayer = ui.create.player().init(...names);
				replayPlayer.seatNum = 3;
				replayPlayer.classList.add("unseen2_v");
				const update = replayPlayer.update;
				let updates = 0;
				replayPlayer.update = function (...args) {
					updates++;
					return update.apply(this, args);
				};
				_status.video = true;
				game.videoContent.reinit3(replayPlayer, { from: names[0], to: "gz_shibing1wei", hp: 3 });
				check(updates === 1 && replayPlayer.name1 === "gz_shibing1wei" && replayPlayer.maxHp === 3, "replay main replacement did not refresh");
				game.videoContent.reinit3(replayPlayer, { from: names[1], to: "gz_simayi", avatar2: true, hp: 3 });
				check(updates === 2 && replayPlayer.name2 === "gz_simayi" && replayPlayer.getName().includes("暗将"), "replay deputy replacement did not retain hiding");
				game.videoContent.showCharacter(replayPlayer, 1);
				check(replayPlayer.getName() === `三号位(${get.translation("gz_shibing1wei")}/${get.translation("gz_simayi")})`, "replay reveal has stale names");
				_status.video = false;
			} else {
				const dialog = get.nodeintro(p);
				const entries = profiles(dialog);
				check(entries.length === 1 && entries[0].textContent === "查看资料", "other mode profile changed");
				check(dialog.content.firstElementChild.textContent.startsWith(get.translation(p.name)), "other mode caption changed");
				entries[0].click();
				check(calls.at(-1)[0] === names[0], "other mode profile target changed");
				dialog.remove();
				cases++;
			}
			window.__profileTrace = [];
			ui.click.charactercard = function (...args) {
				window.__profileTrace.push({ profile: args[0] });
				return originalCard.apply(this, args);
			};
			for (const type of ["mousedown", "mouseup", "click"])
				document.addEventListener(
					type,
					event => {
						window.__profileTrace.push({ type, target: event.target.className, text: event.target.textContent?.slice(0, 20), dragged: _status.dragged });
					},
					true
				);
			window.__preview = { p };
			return { mode, sub, cases, phase: game.phaseNumber, publicNames: game.players.map(player => get.translation(player)) };
		}, scenario);
		console.log("DOM checks complete", report.cases);
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: 900 });
			const layout = await page.evaluate(width => {
				const { ui, lib } = window.__engine;
				lib.config.phonelayout = width < 500;
				const { p } = window.__preview;
				const dialog = ui.click.intro.call(p, { clientX: width / 2, clientY: 100 });
				window.__preview.dialog = dialog;
				const buttons = Array.from(dialog.content.querySelectorAll(".pointerdiv")).filter(node => /^查看/.test(node.textContent));
				const bounds = dialog.getBoundingClientRect();
				return {
					width,
					buttons: buttons.map(button => {
						const r = button.getBoundingClientRect();
						return { text: button.textContent, x: r.x, y: r.y, width: r.width, height: r.height };
					}),
					bounds: { x: bounds.x, right: bounds.right },
				};
			}, width);
			assert.ok(
				layout.buttons.every(button => button.width > 0 && button.height > 0 && button.x >= 0 && button.x + button.width <= width),
				JSON.stringify(layout)
			);
			if (scenario.mode === "guozhan") assert.equal(layout.buttons[0].y, layout.buttons[1].y, JSON.stringify(layout));
			await page.screenshot({ path: `${output}/${scenario.mode}-${scenario.sub}-${width}.png`, timeout: 10000, animations: "disabled" });
			for (let index = 0; index < layout.buttons.length; index++) {
				console.log(`Click profile ${scenario.mode}/${scenario.sub} width=${width} slot=${index}`);
				if (index > 0)
					await page.evaluate(width => {
						window.__preview.dialog = window.__engine.ui.click.intro.call(window.__preview.p, { clientX: width / 2, clientY: 100 });
					}, width);
				const button = await page.evaluateHandle(index => {
					const buttons = Array.from(window.__preview.dialog.content.querySelectorAll(".pointerdiv")).filter(node => /^查看/.test(node.textContent));
					return buttons[index];
				}, index);
				await button.asElement().click({ timeout: 5000 });
				await button.dispose();
				try {
					await page.waitForSelector(".charactercard", { state: "visible", timeout: 5000 });
				} catch (error) {
					console.error("Page errors", errors);
					console.error(await page.evaluate(() => ({ dragged: window.__engine._status.dragged, clicked: window.__engine._status.clicked, intros: document.querySelectorAll("#nodeintro").length, profiles: document.querySelectorAll(".charactercard").length, trace: window.__profileTrace })));
					await page.screenshot({ path: `${output}/failure.png`, animations: "disabled" });
					throw error;
				}
				const nameMatches = await page.evaluate(index => {
					const { get } = window.__engine;
					const name = window.__preview.p[index ? "name2" : "name1"];
					return document.querySelector(".charactercard").textContent.includes(get.translation(name));
				}, index);
				assert.ok(nameMatches, `incorrect profile for slot ${index}`);
				await page.screenshot({ path: `${output}/${scenario.mode}-${scenario.sub}-${width}-profile-${index}.png`, timeout: 10000, animations: "disabled" });
				await page.evaluate(() => document.querySelector(".charactercard").parentElement.click());
				await page.waitForSelector(".charactercard", { state: "detached", timeout: 5000 });
			}
			(report.layouts ??= []).push(layout);
		}
		assert.equal(await page.evaluate(() => window.__engine.game.phaseNumber), report.phase, "game advanced during UI checks");
		report.errors = errors;
		reports.push(report);
		console.log(JSON.stringify(report));
		assert.deepEqual(errors, []);
		await context.close();
	}
} catch (error) {
	console.error(error);
	throw error;
} finally {
	await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2));
	await browser.close();
}
