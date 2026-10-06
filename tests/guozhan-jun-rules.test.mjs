import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../apps/core/${path}`, import.meta.url), "utf8");
const playerPath = "mode/guozhan/src/patch/player.js";
const cardPath = "mode/guozhan/src/card/index.js";
const skillPath = "mode/guozhan/src/skill/character/rest.js";

// Execute the repository's actual methods with a small, isolated game environment.
// No browser, dependencies, or duplicated rule implementation is needed.
function setup() {
	const context = vm.createContext({});
	vm.runInContext(`
		Array.prototype.add = function(value) { if (!this.includes(value)) this.push(value); };
		Array.prototype.remove = function(value) { const i = this.indexOf(value); if (i >= 0) this.splice(i, 1); };
		globalThis.lib = { element: { Player: class {} }, skill: {}, character: {}, selectGroup: [] };
		globalThis._status = { yeidentity: [], initshown: true };
		globalThis.game = {
			players: [], events: [], videos: [], logs: [], broadcasts: 0, resultChecks: 0,
			createEvent(name) { const event = { name, setContent(value) { this.content = value; } }; this.events.push(event); return event; },
			broadcastAll(fn, ...args) { this.broadcasts++; fn(...args); },
			broadcast() {},
			addVideo(...args) { this.videos.push(args); },
			log(...args) { this.logs.push(args); },
			tryResult() { this.resultChecks++; }
		};
		globalThis.get = {
			mode: () => "guozhan", translation: value => value, config: () => "off",
			population: () => 8, totalPopulation: () => 4,
			is: { double: () => false }
		};
	`, context);
	const evaluate = source => vm.runInContext(source, context);
	const method = (path, name) => {
		const source = read(path);
		const start = source.indexOf(`\n\t${name}(`);
		assert.notEqual(start, -1, name);
		const end = source.indexOf("\n\t}", start) + 4;
		return evaluate(`({${source.slice(start, end)}})`)[name];
	};
	const entry = (path, name, nextName) => {
		const source = read(path);
		const start = source.indexOf(`\n\t${name}: {`);
		const end = source.indexOf(`\n\t${nextName}: {`, start);
		assert.ok(start >= 0 && end > start, name);
		return evaluate(`({${source.slice(start, end)}})`)[name];
	};
	context.get.is.jun = method("noname/get/is.js", "jun");
	context.get.zhu = method("noname/get/index.js", "zhu");
	context.setIdentity = method("noname/library/element/player.js", "setIdentity");
	const Player = evaluate(read(playerPath).replace(/^import .*;\n/gm, "").replace("export class PlayerGuozhan", "class PlayerGuozhan") + "\nPlayerGuozhan;");
	const hideSource = read("mode/guozhan/src/patch/content.js");
	const start = hideSource.indexOf("export const hideCharacter = ") + "export const hideCharacter = ".length;
	const hideContent = evaluate(`(${hideSource.slice(start, hideSource.indexOf("\n};", start) + 2)})`);
	context.broadcast = () => {};
	const make = (name, identity = "wei", hiddenMain = false) => {
		const player = new Player();
		const classes = new Set(hiddenMain ? ["unseen"] : []);
		const classList = { add: value => classes.add(value), remove: value => classes.delete(value) };
		const character = group => Object.assign(["male", group, 4, []], { group });
		context.lib.character[name] = character(name == "gz_native_ye" ? "ye" : identity);
		context.lib.character.gz_vice = character("wei");
		Object.assign(player, {
			name, name1: name, name2: "gz_vice", identity, group: identity,
			classList, node: { identity: { firstChild: {}, dataset: {}, classList } },
			storage: {}, skills: [], hiddenSkills: [], ai: {}, marks: {}, _mingzhied: true,
			isUnseen: num => num == 0 ? classes.has("unseen") : num == 1 ? classes.has("unseen2") : num == 2 ? classes.has("unseen") || classes.has("unseen2") : classes.has("unseen") && classes.has("unseen2"),
			isAlive: () => true, isIn: () => true, hasSkill: () => true,
			getStorage: key => player.storage[key] || [],
			setIdentity: context.setIdentity, showCharacter() {}, checkConflict() {},
			addMark: (key, count) => { player.marks[key] = (player.marks[key] || 0) + count; },
			addTempSkill: skill => player.skills.push(skill),
			async draw(count) { this.drawn = (this.drawn || 0) + count; },
			chooseCard() { return { set() { return this; }, async forResult() { return { cards: [1, 2, 3] }; } }; },
			async give(cards, target) { this.given = { cards, target }; await this.onGive?.(); },
		});
		context.game.players.push(player);
		return player;
	};
	return { ...context, make, hideContent, fendao: entry(cardPath, "fendao", "tuqiong"), shantong: entry(skillPath, "gz_ol_shantong", "gz_ol_qiuchou") };
}

test("分道：君主和同势力角色均能摸六交三，但不变野；人数保障和死亡连带仍有效", async () => {
	const { make, game, _status, fendao } = setup();
	const lord = make("gz_jun_caocao");
	const ally = make("gz_ally");
	for (const [player, target] of [[lord, ally], [ally, lord]]) {
		assert.equal(fendao.filterTarget({}, player, target), true);
		await fendao.content({ target }, null, player);
		assert.equal(player.drawn, 6);
		assert.equal(player.given.cards.length, 3);
		assert.equal(player.given.target, target);
		assert.equal(player.identity, "wei");
		assert.equal(player._ye, undefined);
	}
	assert.equal(game.events.length, 0);
	const newcomer = make("gz_newcomer", "unknown", true);
	assert.equal(newcomer.wontYe("wei"), true);
	game.players.splice(game.players.indexOf(lord), 1);
	lord.dieAfter(ally);
	assert.equal(ally.identity, "ye");
	assert.equal(ally.shijun, true);
	assert.ok(_status.yeidentity.includes("wei"));
	assert.equal(newcomer.wontYe("wei"), false);
});

for (const lordState of ["无君主", "异势力君主", "暗置君主", "已死亡君主"]) {
	test(`分道：${lordState}不提供本势力保护，并通知身份变化`, async () => {
		const { make, game, fendao } = setup();
		if (lordState != "无君主") {
			const lord = make("gz_jun_liubei", lordState == "异势力君主" ? "shu" : "wei", lordState == "暗置君主");
			if (lordState == "已死亡君主") game.players.splice(game.players.indexOf(lord), 1);
		}
		const player = make("gz_ally"), target = make("gz_target");
		await fendao.content({ target }, null, player);
		assert.equal(player.identity, "ye");
		assert.equal(player.group, "wei");
		assert.equal(player._ye, undefined);
		assert.equal(player.drawn, 6);
		assert.equal(player.given.cards.length, 3);
		assert.equal(game.broadcasts, 1);
		assert.equal(game.events[0].name, "changeGroupInGuozhan");
		assert.equal(game.events[0].fromGroups[0], "wei");
		assert.equal(game.events[0].toGroup, "ye");
		assert.equal(game.videos[0][0], "setIdentity");
		assert.equal(game.resultChecks, 1);
	});
}

test("分道按给牌完成后的君主状态结算，而非使用时快照", async () => {
	for (const appears of [true, false]) {
		const { make, game, fendao } = setup();
		const player = make("gz_ally"), target = make("gz_target");
		const lord = appears ? null : make("gz_jun_caocao");
		player.onGive = () => {
			if (appears) make("gz_jun_caocao");
			else game.players.splice(game.players.indexOf(lord), 1);
		};
		await fendao.content({ target }, null, player);
		assert.equal(player.identity, appears ? "wei" : "ye");
	}
});

test("原生野心家主将亮出仍变野并获得标记：有君主、或此前用过分道均不受影响", async () => {
	for (const hasLord of [true, false]) {
		const { make, fendao } = setup();
		const target = hasLord ? make("gz_jun_caocao") : make("gz_target");
		const player = make("gz_native_ye", "wei", true);
		await fendao.content({ target }, null, player);
		assert.equal(player.identity, hasLord ? "wei" : "ye");
		player.$showCharacter(0);
		assert.equal(player.identity, "ye");
		assert.equal(player._ye, true);
		assert.equal(player.marks.yexinjia_mark, 1);
		player.$showCharacter(0);
		assert.equal(player.marks.yexinjia_mark, 1);
	}
});

test("暗置入口拒绝君主牌，但允许君主副将和普通主将", () => {
	const { make, game } = setup();
	const lord = make("gz_jun_caocao"), player = make("gz_ally");
	assert.equal(lord.hideCharacter(0), undefined);
	assert.equal(game.events.length, 0);
	assert.equal(lord.hideCharacter(1).num, 1);
	assert.equal(player.hideCharacter(0).num, 0);
});

test("暗置事件直接执行或排队后主将升变时，也不能暗置君主", async () => {
	const { make, hideContent, game } = setup();
	const player = make("gz_ally");
	const event = player.hideCharacter(0);
	const lord = make("gz_jun_caocao");
	player.name1 = lord.name1;
	event.cancel = () => { event.cancelled = true; };
	await hideContent(event, null, player);
	assert.equal(event.cancelled, true);
	assert.equal(player.isUnseen(0), false);
	assert.equal(game.videos.length, 0);
});

test("擅统不给君主提供主将选项，副将和普通主将仍可正常暗置并获得效果", async () => {
	for (const isLord of [true, false]) {
		const { make, shantong, hideContent } = setup();
		const source = make("gz_jianshuo"), target = make(isLord ? "gz_jun_caocao" : "gz_ally");
		const control = isLord ? "副将" : "主将";
		target.chooseControl = (...controls) => {
			assert.equal(controls.includes("主将"), !isLord);
			assert.ok(controls.includes("副将") && controls.includes("cancel2"));
			return { set() { return this; }, async forResult() { return { control }; } };
		};
		const event = {};
		await shantong.cost(event, { player: target }, source);
		assert.equal(event.result.bool, true);
		target.hideCharacter = index => hideContent({ num: index }, null, target);
		await shantong.content(event.result, { player: target }, source);
		assert.equal(target.isUnseen(isLord ? 1 : 0), true);
		assert.equal(target.storage.gz_ol_shantong_effect, true);
		assert.equal(target.storage.gz_ol_shantong_watch.name, isLord ? target.name2 : target.name1);
	}
});

test("擅统选择取消、非法君主主将、暗置未成功均不获得收益", async () => {
	const { make, shantong } = setup();
	const target = make("gz_jun_caocao");
	for (const control of ["主将", "cancel2"]) {
		target.chooseControl = () => ({ set() { return this; }, async forResult() { return { control }; } });
		const event = {};
		await shantong.cost(event, { player: target }, target);
		assert.equal(event.result, undefined);
	}
	await shantong.content({ cost_data: 0 }, { player: target }, target);
	assert.equal(target.storage.gz_ol_shantong_effect, undefined);
	target.hideCharacter = async () => {};
	await shantong.content({ cost_data: 1 }, { player: target }, target);
	assert.equal(target.storage.gz_ol_shantong_effect, undefined);
	assert.equal(target.skills.length, 0);
});
