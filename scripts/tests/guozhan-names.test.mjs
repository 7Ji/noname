import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import ts from "typescript";

const sources = new Map();
const root = new URL("../../", import.meta.url);
const playerPath = "apps/core/mode/guozhan/src/patch/player.js";
const getPath = "apps/core/noname/get/index.js";
const gamePath = "apps/core/noname/game/index.js";

// Load production methods without starting the browser, networking or the game loop.
function member(path, className, name, property) {
	if (!sources.has(path)) {
		sources.set(path, ts.createSourceFile(path, readFileSync(new URL(path, root), "utf8"), ts.ScriptTarget.Latest, true));
	}
	const source = sources.get(path);
	const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className);
	let node = cls.members.find(node => node.name?.getText(source) === name);
	if (property) {
		node = node.initializer.properties.find(node => node.name?.getText(source) === property).initializer;
	}
	return node.getText(source);
}

function exportedFunction(path, name) {
	const source = ts.createSourceFile(path, readFileSync(new URL(path, root), "utf8"), ts.ScriptTarget.Latest, true);
	return source.statements
		.find(node => ts.isFunctionDeclaration(node) && node.name.text === name)
		.getText(source)
		.replace(/^export /, "");
}

function fixture(mode = "guozhan") {
	const lib = {
		translate: { caocao: "曹操", xunyu: "荀彧", guojia: "郭嘉", gz_shibing1wei: "魏兵", sha: "杀" },
		config: { mode, log_highlight: true, show_log: "off" },
		playerOL: {},
	};
	const _status = {};
	const logs = [];
	const videos = [];
	const broadcasts = [];
	const ui = {
		arena: { setNumber() {}, classList: { add() {} } },
		create: { div: (...args) => ({ innerHTML: args[1] }) },
		sidebar: { insertBefore: node => logs.push(node.innerHTML) },
	};
	const game = {
		players: [],
		dead: [],
		playerMap: {},
		addVideo: (...args) => videos.push(args),
		broadcast: (...args) => broadcasts.push(args),
	};
	const get = {
		itemtype: value => (value?.isPlayer ? "player" : Array.isArray(value) ? "players" : ""),
		seatTranslation: seat => ["一", "二", "三", "四"][seat] + "号位",
	};
	const deps = { lib, game, get, ui, _status };
	const compile = code => new Function(...Object.keys(deps), `return (${code});`)(...Object.values(deps));
	const method = (path, cls, name) => compile(`{${member(path, cls, name)}}`)[name];
	const baseNodeIntro = method(getPath, "Get", "nodeintro");
	const baseCardsetion = method(getPath, "Get", "cardsetion");
	Object.assign(deps, { baseNodeIntro, baseCardsetion });
	const baseTranslation = method(getPath, "Get", "translation");
	function setMode(name) {
		lib.config.mode = name;
		get.translation = name === "guozhan" ? new Function("get", "baseTranslation", `return ({${member("apps/core/mode/guozhan/src/patch/get.js", "GetGuozhan", "translation")}}).translation;`)(get, baseTranslation) : baseTranslation;
		for (const key of ["nodeintro", "cardsetion"]) {
			get[key] = name === "guozhan" ? method("apps/core/mode/guozhan/src/patch/get.js", "GetGuozhan", key) : method(getPath, "Get", key);
		}
	}
	setMode(mode);
	game.log = method(gamePath, "Game", "log");
	for (const name of ["getState", "updateState"]) {
		game[name] = method("apps/core/mode/guozhan/src/patch/game.js", "GameGuozhan", name);
	}
	const baseVideo = Object.fromEntries(["init", "showCharacter", "hideCharacter", "reinit3", "log"].map(name => [name, compile(member(gamePath, "Game", "videoContent", name))]));
	const createVideo = compile(exportedFunction("apps/core/mode/guozhan/src/patch/game.js", "createGuozhanVideoContent"));
	const video = mode === "guozhan" ? createVideo(baseVideo) : baseVideo;
	function player(seat = 2) {
		const classes = new Set(["unseen", "unseen2"]);
		const value = {
			isPlayer: true,
			name: `unknown${seat}`,
			name1: "caocao",
			name2: "xunyu",
			identity: "unknown",
			ai: { shown: 0 },
			storage: {},
			node: { identity: { firstChild: {}, dataset: {}, classList: { add() {}, remove() {} } } },
			dataset: { position: "0" },
			classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
			init(name1, name2) {
				this.name1 = this.name = name1;
				this.name2 = name2;
				this.group = "wei";
			},
			setNickname() {},
			setIdentity() {},
		};
		for (const name of ["getGuozhanSeat", "getName", "getModeState", "setModeState"]) {
			value[name] = method(playerPath, "PlayerGuozhan", name);
		}
		value.isMad = () => false;
		value.isUnderControl = method("apps/core/noname/library/element/player.js", "Player", "isUnderControl");
		value.isUnseen = method("apps/core/noname/library/element/player.js", "Player", "isUnseen");
		return value;
	}
	return { ...deps, player, video, baseVideo, createVideo, logs, videos, broadcasts, setMode };
}

test("four visibility combinations, repeated hiding and stale internal names", () => {
	const { player, get } = fixture();
	const p = player();
	for (const [hidden, expected] of [
		[[true, true], "暗将/暗将"],
		[[false, true], "曹操/暗将"],
		[[true, false], "暗将/荀彧"],
		[[false, false], "曹操/荀彧"],
		[[true, true], "暗将/暗将"],
	]) {
		for (const [index, name] of ["unseen", "unseen2"].entries()) {
			p.classList[hidden[index] ? "add" : "remove"](name);
		}
		assert.equal(get.translation(p), `三号位(${expected})`);
		assert.equal(p.getName(), get.translation(p));
		p.name = "unrelated_stale_name";
	}
	assert.equal(p.name1, "caocao");
	assert.equal(p.name2, "xunyu");
});

test("soldiers, deputy replacement, death and seat changes", () => {
	const { player, get, game } = fixture();
	const p = player();
	p.getName();
	p.name1 = "gz_shibing1wei";
	p.classList.remove("unseen");
	assert.equal(p.getName(), "三号位(魏兵/暗将)");
	p.name2 = "guojia";
	p.classList.remove("unseen2");
	p.classList.add("dead");
	p.dataset.position = "0";
	game.players = [];
	assert.equal(p.getName(), "三号位(魏兵/郭嘉)");
	p.name2 = "gz_shibing1wei";
	assert.equal(get.translation(p), "三号位(魏兵/魏兵)");
});

test("arrays and dialog labels agree; character IDs and custom translations retain meaning", () => {
	const { player, get } = fixture();
	const p = player();
	assert.equal(get.translation([p, p]), `${p.getName()}、${p.getName()}`);
	assert.ok(p.getName(true).includes(p.getName()));
	assert.ok(p.getName(true).endsWith('<br/><span style="color:#FFD700">'));
	assert.equal(get.translation("caocao"), "曹操");
	assert.equal(get.translation({ name: "guojia" }), "郭嘉");
	p._tempTranslate = "自定义称呼";
	assert.equal(get.translation(p), p._tempTranslate);
	assert.ok(p.getName(true).includes(p._tempTranslate));
});

test("mode snapshots and online state preserve the opening seat", () => {
	const { player, game, lib } = fixture();
	const p = player();
	const mode = JSON.parse(JSON.stringify(p.getModeState()));
	const restored = player(0);
	restored.setModeState({ mode, name: "caocao", name1: "caocao", name2: "xunyu" });
	assert.equal(restored.getName(), "三号位(暗将/暗将)");
	lib.playerOL.p = p;
	const state = JSON.parse(JSON.stringify(game.getState()));
	lib.playerOL.p = restored;
	restored.guozhanSeat = 0;
	game.updateState(state);
	assert.equal(restored.guozhanSeat, 2);
	game.updateState({ p: { identity: "unknown", shown: 0 } });
	assert.equal(restored.guozhanSeat, 2);
	const legacy = player();
	legacy.setModeState({ mode: { unseen: true, unseen2: true }, name: "unknown2", name1: "caocao", name2: "xunyu" });
	assert.equal(legacy.getName(), "三号位(暗将/暗将)");
});

test("logs broadcast and record the label at creation time", () => {
	const { player, game, logs, videos, broadcasts, _status, video } = fixture();
	const p = player();
	_status.video = true;
	p.classList.add("unseen_v");
	p.classList.add("unseen2_v");
	game.log(p, "摸牌");
	const original = logs[0];
	video.showCharacter(p, 2);
	assert.equal(p.getName(), "三号位(曹操/荀彧)");
	assert.ok(original.includes("三号位(暗将/暗将)"));
	assert.equal(videos[0][2], original);
	assert.equal(broadcasts[0][1], original);
	video.hideCharacter(p, 2);
	assert.equal(p.getName(), "三号位(暗将/暗将)");
	video.log("旧录像中的原始称呼");
	assert.equal(logs[1], "旧录像中的原始称呼");
});

test("new and legacy replay initialization restore seats before names change", () => {
	for (const seat of [undefined, 2]) {
		const { player, game, lib, ui, video, _status } = fixture();
		_status.video = true;
		ui.create.players = count => {
			game.players = Array.from({ length: count }, () => player(0));
		};
		ui.handcards1Container = ui.handcards2Container = { appendChild() {} };
		ui.updatehl = () => {};
		video.init([{ name: "unknown2", name1: "caocao", name2: "xunyu", translate: "三号位", guozhanSeat: seat }]);
		assert.equal(game.me.getName(), "三号位(暗将/暗将)");
		video.showCharacter(game.me, 0);
		assert.equal(game.me.getName(), "三号位(曹操/暗将)");
		assert.equal(lib.translate.caocao, "曹操");
	}
});

test("replay replacements update the correct slot, including hidden soldiers", () => {
	const { player, video, lib, get, _status } = fixture();
	_status.video = true;
	lib.character = Object.fromEntries(["caocao", "xunyu", "guojia", "gz_shibing1wei"].map(name => [name, ["male", "wei", 4, []]]));
	get.slimName = name => lib.translate[name];
	const p = player();
	p.getGuozhanSeat();
	p.node.avatar = p.node.avatar2 = { setBackground() {} };
	p.node.name = p.node.name2 = {};
	p.update = () => {};
	p.classList.add("unseen2_v");
	video.reinit3.call(p, p, { from: "caocao", to: "gz_shibing1wei", hp: 4 });
	assert.equal(p.getName(), "三号位(魏兵/暗将)");
	video.reinit3.call(p, p, { from: "xunyu", to: "guojia", avatar2: true, hp: 4 });
	assert.equal(p.getName(), "三号位(魏兵/暗将)");
	video.showCharacter(p, 1);
	assert.equal(p.getName(), "三号位(魏兵/郭嘉)");
});

function introFixture() {
	const env = fixture();
	const { lib, game, get, ui, player } = env;
	Object.assign(lib, { character: {}, characterTitle: {}, characterAppend: {}, characterPack: {} });
	get.mode = () => lib.config.mode;
	get.is = { phoneLayout: () => false };
	get.character = () => [];
	get.characterInitFilter = () => [];
	game.filterSkills = skills => skills;
	const calls = [];
	ui.click = { charactercard: (...args) => calls.push(args) };
	ui.update = () => {};
	ui.create.div = (selector, parent) => {
		const classes = new Set(selector.split(".").filter(Boolean));
		const element = {
			children: [],
			style: {},
			attributes: {},
			innerHTML: "",
			classList: { add: name => classes.add(name), contains: name => classes.has(name) },
			get firstElementChild() {
				return this.children[0];
			},
			get lastElementChild() {
				return this.children.at(-1);
			},
			appendChild(child) {
				this.insertBefore(child, null);
			},
			insertBefore(child, anchor) {
				child.remove();
				child.parentNode = this;
				const index = anchor ? this.children.indexOf(anchor) : this.children.length;
				assert.ok(index >= 0);
				this.children.splice(index, 0, child);
			},
			remove() {
				if (this.parentNode) {
					this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
					this.parentNode = null;
				}
			},
			setAttribute(name, value) {
				this.attributes[name] = value;
			},
			listen(callback) {
				this.click = callback;
			},
		};
		parent?.appendChild(element);
		return element;
	};
	const p = player();
	p.getGuozhanSeat();
	p.classList.add("player");
	p.getSkills = p.getCards = () => [];
	p.hiddenSkills = [];
	p.skin = { name: "main_skin", name2: "vice_skin" };
	p.node.avatar = { slot: "main" };
	p.node.avatar2 = { slot: "vice" };
	const headings = [];
	const open = (simple = false, node = p) => {
		headings.length = 0;
		const content = ui.create.div(".content");
		const dialog = {
			content,
			setAttribute() {},
			add(entry) {
				if (typeof entry === "string") {
					const caption = ui.create.div(".caption", content);
					caption.innerHTML = entry;
					return caption;
				}
				content.appendChild(entry);
				return entry;
			},
		};
		get.nodeintro(node, simple, undefined, dialog);
		headings.push(...content.children.filter(entry => entry.classList.contains("caption")).map(entry => entry.innerHTML));
		return content.children.flatMap(entry => [entry, ...entry.children]).filter(entry => entry.innerHTML?.startsWith("查看"));
	};
	return { ...env, p, open, calls, headings };
}

test("guozhan player help only includes revealed profiles in main/deputy order", () => {
	for (const replay of [false, true]) {
		for (const hidden of [
			[true, true],
			[false, true],
			[true, false],
			[false, false],
		]) {
			const { p, open, calls, _status, headings } = introFixture();
			_status.video = replay;
			for (const [index, isHidden] of hidden.entries()) {
				const marker = ["unseen", "unseen2"][index] + (replay ? "_v" : "");
				p.classList[isHidden ? "add" : "remove"](marker);
			}
			p.name = hidden[0] ? (hidden[1] ? "unknown2" : "xunyu") : "caocao";
			const entries = open();
			assert.equal(headings[0], p.getName());
			const visible = [0, 1].filter(index => !hidden[index]);
			assert.deepEqual(
				entries.map(entry => entry.innerHTML),
				visible.map(index => (index ? "查看副将" : "查看主将"))
			);
			for (const [i, entry] of entries.entries()) {
				const index = visible[i];
				entry.click();
				assert.deepEqual(calls.at(-1), [index ? "xunyu" : "caocao", null, null, true, p.node[index ? "avatar2" : "avatar"], index ? "vice_skin" : "main_skin"]);
			}
			assert.equal(calls.length, visible.length);
		}
	}
});

test("an open profile option rechecks hiding, replacements and missing generals", () => {
	const { p, open, calls } = introFixture();
	p.classList.remove("unseen");
	p.classList.remove("unseen2");
	const entries = open();
	p.classList.add("unseen");
	entries[0].click();
	assert.equal(calls.length, 0);
	p.name2 = "guojia";
	delete p.skin.name2;
	entries[1].click();
	assert.equal(calls[0][0], "guojia");
	assert.equal(calls[0][5], "guojia");
	delete p.name2;
	entries[1].click();
	assert.equal(calls.length, 1);
	assert.equal(open().length, 0);
});

test("other modes retain the existing single profile entry and simple menus stay compact", () => {
	const { p, open, calls, setMode } = introFixture();
	setMode("identity");
	p.name = "caocao";
	const entries = open();
	assert.deepEqual(
		entries.map(entry => entry.innerHTML),
		["查看资料"]
	);
	entries[0].click();
	assert.equal(calls[0][0], "caocao");
	p.name = "unknown2";
	assert.equal(open().length, 0);
	setMode("guozhan");
	assert.equal(open(true).length, 0);
});

test("own and controlled hidden generals are viewable, but observed and replay generals stay hidden", () => {
	const { p, open, game, calls, _status } = introFixture();
	game.me = p;
	const entries = open();
	assert.deepEqual(
		entries.map(entry => entry.innerHTML),
		["查看主将", "查看副将"]
	);
	entries[0].click();
	entries[1].click();
	assert.deepEqual(
		calls.map(call => call[0]),
		["caocao", "xunyu"]
	);
	game.me = { hiddenSkills: [], isMad: () => false };
	assert.equal(open().length, 0);
	entries[0].click();
	assert.equal(calls.length, 2);
	p._trueMe = game.me;
	assert.equal(open().length, 2);
	game.observe = true;
	assert.equal(open().length, 0);
	game.observe = false;
	game.me = p;
	_status.video = true;
	p.classList.add("unseen_v");
	p.classList.add("unseen2_v");
	assert.equal(open().length, 0);
});

test("player help headings use current slots despite stale names and retain other mode behavior", () => {
	const { p, open, headings, setMode } = introFixture();
	const check = expected => {
		open();
		assert.equal(headings[0], expected);
		open(true);
		assert.equal(headings[0], expected);
	};
	p.name = "caocao";
	check("三号位(暗将/暗将)");
	p.classList.remove("unseen2");
	check("三号位(暗将/荀彧)");
	p.classList.remove("unseen");
	check("三号位(曹操/荀彧)");
	p.classList.add("unseen2");
	check("三号位(曹操/暗将)");
	p.classList.add("unseen");
	check("三号位(暗将/暗将)");
	p.classList.add("dead");
	p.classList.remove("unseen");
	p.name1 = "gz_shibing1wei";
	check("三号位(魏兵/暗将)");
	setMode("identity");
	check("曹操");
});

test("other mode help retains original names and profiles, including custom translations", () => {
	for (const mode of ["identity", "versus", "doudizhu", "boss", "chess"]) {
		const { p, open, calls, headings, setMode, get, lib } = introFixture();
		setMode(mode);
		p.name = "caocao";
		p._tempTranslate = "自定义角色称呼";
		lib.translate.caocao_ab = "曹";
		assert.equal(get.translation(p), p._tempTranslate);
		assert.equal(get.playerName, undefined);
		const entries = open();
		assert.equal(headings[0], "曹操");
		assert.deepEqual(
			entries.map(entry => entry.innerHTML),
			["查看资料"]
		);
		entries[0].click();
		assert.deepEqual(calls[0], ["caocao", null, null, true, p.node.avatar, "main_skin"]);
	}
});

test("guozhan animation override changes only the caption and preserves event queries", () => {
	const { get, game, player, _status, lib, setMode } = fixture();
	const p = player();
	p.getGuozhanSeat();
	p.name = "caocao";
	p.getSeatNum = () => 3;
	get.slimName = () => "曹操";
	get.bordergroup = () => "wei";
	get.groupnature = () => "water";
	game.hasPlayer2 = () => true;
	const parent = { name: "phaseUse" };
	_status.event = { name: "useCard", getParent: () => parent };
	get.event = () => _status.event;
	lib.translate.useCard = "使用牌";
	lib.card = lib.skill = {};
	assert.equal(get.cardsetion(p), `${p.getName(true)}使用牌</span>使用</span>`);
	assert.equal(get.cardsetion(p, true), _status.event);
	setMode("identity");
	assert.equal(get.cardsetion(p), '<span style="font-weight:700"><span data-nature=water><span style="letter-spacing:0.1em">曹操[3]</span></span><br/><span style="color:#FFD700">使用牌</span>使用</span>');
	setMode("guozhan");
	game.online = true;
	assert.equal(get.cardsetion(p), undefined);
});

test("guozhan replay handlers leave shared handler objects unchanged", () => {
	const { baseVideo, createVideo } = fixture();
	const originals = { ...baseVideo };
	const wrapped = createVideo(baseVideo);
	assert.notEqual(wrapped, baseVideo);
	assert.deepEqual(baseVideo, originals);
	assert.notEqual(wrapped.init, baseVideo.init);
	assert.notEqual(wrapped.reinit3, baseVideo.reinit3);
	assert.equal(wrapped.showCharacter, baseVideo.showCharacter);
});

test("guozhan help preserves header details and custom intros, and handles linked players", () => {
	const { p, lib, open, headings } = introFixture();
	p.name = "caocao";
	p.sex = "male";
	p.group = "wei";
	lib.config.show_sex = lib.config.show_group = true;
	lib.translate.male = "男";
	lib.translate.wei = "魏";
	open();
	assert.equal(headings[0], `${p.getName()}&nbsp;&nbsp;男&nbsp;&nbsp;魏`);
	const linked = { linkplayer: true, link: p, classList: { contains: () => false } };
	open(false, linked);
	assert.equal(headings[0], `${p.getName()}&nbsp;&nbsp;男&nbsp;&nbsp;魏`);
	p._customintro = ["自定义标题", "自定义内容"];
	open();
	assert.equal(headings[0], "自定义标题");
});
