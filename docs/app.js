"use strict";

const $ = (id) => document.getElementById(id);
const THINK_MS = 3000;
const AUTO_MS = 2000;
let sections = [], selected, queue = [], index = 0;
let phase = "setup", pausedPhase, remaining = THINK_MS, deadline = 0;
let frame = 0, advanceTimer = 0, revision = 0;
let context, source, currentBuffer, autoAdvance = false, studyMode = false;
const audioCache = new Map();

function screen(name) {
  for (const id of ["setup", "practice", "complete"]) $(id).hidden = id !== name;
}

function stopActivity() {
  cancelAnimationFrame(frame);
  clearTimeout(advanceTimer);
  frame = advanceTimer = 0;
  if (source) {
    source.onended = null;
    source.stop();
    source.disconnect();
    source = null;
  }
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function selectSection(section) {
  selected = section;
  for (const button of $("sections").children) {
    button.setAttribute("aria-pressed", String(button.dataset.section === section.id));
  }
  $("selection").textContent = `${section.title} · ${section.sentences.length}文`;
  $("start").disabled = false;
}

async function loadAudio(item) {
  if (!audioCache.has(item.audio)) {
    const pending = fetch(item.audio, { signal: AbortSignal.timeout(15000) })
      .then((response) => {
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .catch((error) => { audioCache.delete(item.audio); throw error; });
    audioCache.set(item.audio, pending);
  }
  return audioCache.get(item.audio);
}

function paintTimer() {
  const seconds = Math.max(0, remaining) / 1000;
  $("seconds").textContent = seconds.toFixed(1);
  $("timer-fill").style.transform = `scaleX(${seconds / 3})`;
  $("timer").setAttribute("aria-valuenow", seconds.toFixed(1));
}

function runTimer() {
  // Start on the frame that paints the Japanese sentence, after audio is ready.
  frame = requestAnimationFrame((now) => {
    if (phase !== "thinking") return;
    deadline = now + remaining;
    function tick(time) {
      if (phase !== "thinking") return;
      remaining = Math.max(0, deadline - time);
      paintTimer();
      if (remaining === 0) reveal();
      else frame = requestAnimationFrame(tick);
    }
    tick(now);
  });
}

function scheduleNext() {
  if (autoAdvance && phase === "answer") {
    $("playback-status").textContent = index === queue.length - 1
      ? "2秒後に練習を終了します" : "2秒後に次の文へ進みます";
    advanceTimer = setTimeout(next, AUTO_MS);
  } else {
    $("playback-status").textContent = "もう一度聞くか、次へ進んでください";
  }
}

function playAnswer() {
  if (phase !== "answer") return;
  stopActivity();
  $("audio-error").hidden = true;
  if (context.state !== "running") {
    $("playback-status").textContent = "音声を再生するには「もう一度聞く」を押してください";
    return;
  }
  try {
    source = context.createBufferSource();
    source.buffer = currentBuffer;
    source.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      source = null;
      if (phase === "answer") scheduleNext();
    };
    source.start();
    $("playback-status").textContent = "音声を再生しています";
  } catch (error) {
    console.error(error);
    stopActivity();
    $("playback-status").textContent = "再生できませんでした。「もう一度聞く」を押してください";
  }
}

function reveal() {
  phase = "answer";
  remaining = 0;
  paintTimer();
  $("phase-label").textContent = studyMode ? "音声を聞いて、声に出してみましょう" : "英文と音声で確認";
  $("prompt").hidden = true;
  $("english").textContent = queue[index].english;
  $("note").textContent = queue[index].note;
  $("note").hidden = !queue[index].note;
  $("answer").hidden = false;
  $("replay").disabled = $("next").disabled = false;
  if (document.hidden) pause();
  else playAnswer();
}

async function showQuestion() {
  stopActivity();
  const token = ++revision;
  phase = "loading";
  currentBuffer = null;
  $("pause").textContent = "一時停止";
  $("pause").disabled = $("next").disabled = $("replay").disabled = true;
  $("answer").hidden = $("paused").hidden = $("audio-error").hidden = true;
  $("english").textContent = "";
  $("phase-label").textContent = "準備中";
  $("timer").hidden = $("timer-number").hidden = studyMode;
  $("answer-label").textContent = studyMode ? "ENGLISH" : "ANSWER";
  $("japanese").textContent = "音声を準備しています…";
  $("japanese").hidden = false;
  $("prompt").hidden = true;
  $("playback-status").textContent = "";
  $("position").textContent = `${index + 1} / ${queue.length}`;
  $("session-progress").max = queue.length;
  $("session-progress").value = index;
  $("next").textContent = index === queue.length - 1 ? "練習を終える ✓" : "次へ →";
  remaining = THINK_MS;
  paintTimer();
  try {
    const buffer = await loadAudio(queue[index]);
    if (token !== revision) return;
    currentBuffer = buffer;
    $("japanese").textContent = queue[index].japanese;
    $("pause").disabled = false;
    if (studyMode) {
      reveal();
    } else {
      $("prompt").hidden = false;
      $("phase-label").textContent = "英語を声に出してみましょう";
      phase = "thinking";
      deadline = 0;
      if (document.hidden) pause();
      else runTimer();
    }
    if (queue[index + 1]) loadAudio(queue[index + 1]).catch(() => {});
  } catch (error) {
    if (token !== revision) return;
    console.error(error);
    phase = "error";
    $("japanese").textContent = "音声を読み込めませんでした";
    $("phase-label").textContent = "読み込みエラー";
    $("audio-error-text").textContent = "通信状況を確認して、もう一度読み込んでください。"
      + (studyMode ? "" : "タイマーはまだ始まっていません。");
    $("audio-error").hidden = false;
  }
}

async function start() {
  if (!selected || !["setup", "complete"].includes(phase)) return;
  const token = ++revision;
  phase = "loading";
  $("start").disabled = true;
  $("fatal").hidden = true;
  try {
    // Unlock sound directly from the Start click, including on mobile Safari.
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    if (token !== revision) return;
    const random = document.querySelector('input[name="order"]:checked').value === "random";
    studyMode = document.querySelector('input[name="mode"]:checked').value === "study";
    queue = random ? shuffle(selected.sentences) : [...selected.sentences];
    autoAdvance = $("auto").checked;
    audioCache.clear();
    index = 0;
    $("practice-title").textContent = selected.title;
    $("order-label").textContent = `${studyMode ? "学習" : "3秒チャレンジ"} · ${random ? "ランダム" : "掲載順"}`;
    screen("practice");
    $("practice-title").focus();
    await showQuestion();
  } catch (error) {
    if (token !== revision) return;
    console.error(error);
    phase = "setup";
    screen("setup");
    $("start").disabled = false;
    $("fatal").textContent = "音声を準備できませんでした。最新版のSafari、Chrome、Edgeなどで開き、もう一度お試しください。";
    $("fatal").hidden = false;
  }
}

function next() {
  if (phase !== "answer") return;
  stopActivity();
  if (index + 1 < queue.length) {
    index++;
    showQuestion();
  } else {
    revision++;
    phase = "complete";
    $("session-progress").value = queue.length;
    $("complete-detail").textContent = `${selected.title}の${queue.length}文を練習しました。`;
    screen("complete");
    $("complete-title").focus();
  }
}

function pause() {
  if (!["thinking", "answer"].includes(phase)) return;
  pausedPhase = phase;
  if (phase === "thinking" && deadline) remaining = Math.max(0, deadline - performance.now());
  stopActivity();
  phase = "paused";
  $("pause").textContent = "再開する";
  $("phase-label").textContent = "一時停止中";
  $("paused").hidden = false;
  $("japanese").hidden = $("prompt").hidden = $("answer").hidden = true;
  $("replay").disabled = $("next").disabled = true;
  $("playback-status").textContent = "";
  paintTimer();
}

async function resume() {
  if (phase !== "paused") return;
  const token = revision;
  try {
    await context.resume();
    if (phase !== "paused" || token !== revision || document.hidden) return;
    phase = pausedPhase;
    $("paused").hidden = true;
    $("japanese").hidden = false;
    $("pause").textContent = "一時停止";
    if (phase === "thinking") {
      $("prompt").hidden = false;
      $("phase-label").textContent = "英語を声に出してみましょう";
      deadline = 0;
      runTimer();
    } else reveal();
  } catch (error) {
    console.error(error);
    $("playback-status").textContent = "音声を再開できませんでした。もう一度「再開する」を押してください。";
  }
}

function home() {
  revision++;
  stopActivity();
  audioCache.clear();
  phase = "setup";
  $("start").disabled = false;
  $("fatal").hidden = true;
  screen("setup");
  $("start").focus();
}

$("settings").addEventListener("submit", (event) => { event.preventDefault(); start(); });
$("again").addEventListener("click", start);
$("back").addEventListener("click", home);
$("choose").addEventListener("click", home);
$("next").addEventListener("click", next);
$("retry").addEventListener("click", () => { if (phase === "error") showQuestion(); });
$("pause").addEventListener("click", () => phase === "paused" ? resume() : pause());
$("replay").addEventListener("click", async () => {
  const token = revision;
  if (phase !== "answer") return;
  stopActivity();
  try {
    await context.resume();
    if (token === revision && phase === "answer") playAnswer();
  } catch (error) {
    console.error(error);
    $("playback-status").textContent = "再生できませんでした。もう一度お試しください。";
  }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-cache", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Data HTTP ${response.status}`);
    const data = await response.json();
    sections = data.sections;
    if (!Array.isArray(sections) || !sections.length || sections.some((s) => !s.sentences?.length)) {
      throw new Error("No valid sections");
    }
    $("sections").replaceChildren();
    for (const section of sections) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "section-card";
      button.dataset.section = section.id;
      button.setAttribute("aria-pressed", "false");
      const number = document.createElement("span");
      number.className = "section-number";
      number.textContent = section.id;
      const copy = document.createElement("span");
      copy.className = "section-copy";
      const title = document.createElement("span");
      title.className = "section-name";
      title.textContent = section.title;
      const count = document.createElement("span");
      count.className = "section-count";
      count.textContent = `${section.sentences.length}文`;
      const check = document.createElement("span");
      check.className = "section-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      copy.append(title, count);
      button.append(number, copy, check);
      button.addEventListener("click", () => selectSection(section));
      $("sections").append(button);
    }
    const count = sections.reduce((sum, section) => sum + section.sentences.length, 0);
    $("total").textContent = `${sections.length}場面 · ${count}文`;
    selectSection(sections[0]);
  } catch (error) {
    console.error(error);
    $("loading").textContent = "教材を読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。";
  }
}

init();
