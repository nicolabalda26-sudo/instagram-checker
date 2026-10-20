(() => {
  "use strict";

  const FOLDER = "followers_and_following/";
  const FOLLOWERS_RE = /(^|\/)followers_and_following\/followers_(\d+)\.json$/i;
  const FOLLOWING_RE = /(^|\/)followers_and_following\/following\.json$/i;

  const $ = (id) => document.getElementById(id);
  const fileInput = $("file-input");
  const dropzone = $("dropzone");
  const statusBox = $("status");
  const resultsSection = $("results");
  const resultList = $("result-list");
  const emptyMsg = $("empty");
  const searchInput = $("search");

  let notFollowingBack = [];

  // ---------- UI helpers ----------

  function setStatus(type, message) {
    statusBox.hidden = false;
    statusBox.className = `status ${type}`;
    statusBox.textContent = message;
  }

  function profileUrl(username) {
    return `https://www.instagram.com/${encodeURIComponent(username)}/`;
  }

  function renderList(filter = "") {
    const q = filter.trim().toLowerCase();
    const items = q ? notFollowingBack.filter((u) => u.toLowerCase().includes(q)) : notFollowingBack;

    const frag = document.createDocumentFragment();
    for (const username of items) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = profileUrl(username);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = username;
      li.appendChild(a);
      frag.appendChild(li);
    }
    resultList.replaceChildren(frag);

    if (notFollowingBack.length === 0) {
      emptyMsg.textContent = "🎉 Tutti quelli che segui ti seguono a loro volta!";
      emptyMsg.hidden = false;
    } else if (items.length === 0) {
      emptyMsg.textContent = "Nessun utente corrisponde alla ricerca.";
      emptyMsg.hidden = false;
    } else {
      emptyMsg.hidden = true;
    }
  }

  // ---------- Parsing ----------

  async function readJson(entry, label) {
    const text = await entry.async("string");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Il file "${label}" non è un JSON valido.`);
    }
  }

  // Lista 1: item.string_list_data[0].value per ogni elemento dell'array radice
  function extractFollowers(data, label) {
    const arr = Array.isArray(data) ? data : data && data.relationships_followers;
    if (!Array.isArray(arr)) {
      throw new Error(`Struttura non riconosciuta in "${label}": era atteso un array di follower.`);
    }
    const out = [];
    for (const item of arr) {
      const value = item && Array.isArray(item.string_list_data) && item.string_list_data[0]
        ? item.string_list_data[0].value
        : undefined;
      const name = value || (item && item.title);
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
    return out;
  }

  // Lista 2: item.title per ogni elemento di relationships_following
  function extractFollowing(data, label) {
    const arr = data && data.relationships_following;
    if (!Array.isArray(arr)) {
      throw new Error(`Struttura non riconosciuta in "${label}": manca l'array "relationships_following".`);
    }
    const out = [];
    for (const item of arr) {
      // Fallback per esportazioni più vecchie in cui il nome è in string_list_data[0].value
      const name = (item && item.title) ||
        (item && Array.isArray(item.string_list_data) && item.string_list_data[0] && item.string_list_data[0].value);
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
    return out;
  }

  async function processZip(file) {
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new Error("Impossibile aprire il file: non sembra un archivio ZIP valido.");
    }

    const entries = Object.values(zip.files).filter((e) => !e.dir);
    const norm = (e) => e.name.replace(/\\/g, "/");

    const followerEntries = entries
      .filter((e) => FOLLOWERS_RE.test(norm(e)))
      .sort((a, b) => Number(norm(a).match(FOLLOWERS_RE)[2]) - Number(norm(b).match(FOLLOWERS_RE)[2]));
    const followingEntry = entries.find((e) => FOLLOWING_RE.test(norm(e)));

    const missing = [];
    if (followerEntries.length === 0) missing.push(`connections/${FOLDER}followers_1.json`);
    if (!followingEntry) missing.push(`connections/${FOLDER}following.json`);
    if (missing.length) {
      const hasHtml = entries.some((e) => /followers_and_following\/.*\.html$/i.test(norm(e)));
      let msg = `File mancanti nell'archivio:\n• ${missing.join("\n• ")}`;
      if (hasHtml) {
        msg += "\n\nL'esportazione sembra in formato HTML: richiedi di nuovo i dati a Instagram scegliendo il formato JSON.";
      } else {
        msg += "\n\nAssicurati di aver incluso \"Follower e persone seguite\" nella richiesta di download.";
      }
      throw new Error(msg);
    }

    // Instagram divide i follower in followers_1.json, followers_2.json, … per account grandi
    const followers = [];
    for (const entry of followerEntries) {
      const label = norm(entry).split("/").pop();
      followers.push(...extractFollowers(await readJson(entry, label), label));
    }
    const following = extractFollowing(await readJson(followingEntry, "following.json"), "following.json");

    return { followers, following };
  }

  function compare(followers, following) {
    const followerSet = new Set(followers.map((u) => u.toLowerCase()));
    const seen = new Set();
    const result = [];
    for (const u of following) {
      const key = u.toLowerCase();
      if (!followerSet.has(key) && !seen.has(key)) {
        seen.add(key);
        result.push(u);
      }
    }
    return result.sort((a, b) => a.localeCompare(b));
  }

  async function handleFile(file) {
    if (!file) return;
    $("file-name").textContent = file.name;
    resultsSection.hidden = true;

    if (!/\.zip$/i.test(file.name)) {
      setStatus("error", "Seleziona un file .zip esportato da Instagram.");
      return;
    }
    if (typeof JSZip === "undefined") {
      setStatus("error", "Libreria JSZip non caricata. Controlla la connessione internet e ricarica la pagina.");
      return;
    }

    setStatus("loading", "⏳ Estrazione e analisi dell'archivio in corso…");
    try {
      const { followers, following } = await processZip(file);
      if (following.length === 0) {
        throw new Error("Il file following.json non contiene alcun utente.");
      }
      notFollowingBack = compare(followers, following);

      $("count-following").textContent = new Set(following.map((u) => u.toLowerCase())).size;
      $("count-followers").textContent = new Set(followers.map((u) => u.toLowerCase())).size;
      $("count-result").textContent = notFollowingBack.length;

      searchInput.value = "";
      renderList();
      document.querySelectorAll(".downloads button").forEach((b) => (b.disabled = notFollowingBack.length === 0));
      resultsSection.hidden = false;
      setStatus("success", `✅ Analisi completata: ${notFollowingBack.length} utenti non ti seguono a tua volta.`);
    } catch (err) {
      console.error(err);
      setStatus("error", `❌ ${err.message || "Errore imprevisto durante l'elaborazione."}`);
    }
  }

  // ---------- Download ----------

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function downloadBlob(content, mime, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(v) {
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function exportCsv() {
    const rows = ["#,username,profile_url"];
    notFollowingBack.forEach((u, i) => rows.push([i + 1, csvCell(u), profileUrl(u)].join(",")));
    // BOM per una corretta apertura in Excel
    downloadBlob("﻿" + rows.join("\r\n"), "text/csv;charset=utf-8", `non_ti_seguono_${dateStamp()}.csv`);
  }

  function exportTxt() {
    const header = `Non ti seguono a tua volta (${notFollowingBack.length}) - ${dateStamp()}\n\n`;
    downloadBlob(header + notFollowingBack.join("\n") + "\n", "text/plain;charset=utf-8", `non_ti_seguono_${dateStamp()}.txt`);
  }

  function exportPdf() {
    if (!window.jspdf) {
      setStatus("error", "Libreria jsPDF non caricata. Controlla la connessione internet e ricarica la pagina.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 18;
    const lineH = 6.5;

    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Non ti seguono a tua volta", margin, margin);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(110);
      doc.text(`Totale: ${notFollowingBack.length}  ·  Generato il ${new Date().toLocaleDateString("it-IT")}`, margin, margin + 7);
      doc.setTextColor(0);
      doc.setDrawColor(220);
      doc.line(margin, margin + 11, pageW - margin, margin + 11);
      return margin + 19;
    };

    let y = drawHeader();
    doc.setFontSize(11);
    notFollowingBack.forEach((u, i) => {
      if (y > pageH - margin) {
        doc.addPage();
        y = drawHeader();
        doc.setFontSize(11);
      }
      doc.setTextColor(140);
      doc.text(`${i + 1}.`, margin + 10, y, { align: "right" });
      doc.setTextColor(0);
      doc.textWithLink(u, margin + 13, y, { url: profileUrl(u) });
      y += lineH;
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text(`${p} / ${pages}`, pageW - margin, pageH - 8, { align: "right" });
    }

    doc.save(`non_ti_seguono_${dateStamp()}.pdf`);
  }

  // ---------- Events ----------

  fileInput.addEventListener("change", () => {
    handleFile(fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  searchInput.addEventListener("input", () => renderList(searchInput.value));

  document.querySelector(".downloads").addEventListener("click", (e) => {
    const format = e.target.closest("button")?.dataset.format;
    if (!format || notFollowingBack.length === 0) return;
    ({ csv: exportCsv, txt: exportTxt, pdf: exportPdf })[format]();
  });
})();
