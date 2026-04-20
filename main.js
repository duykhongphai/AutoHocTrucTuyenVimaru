// ==UserScript==
// @name         AutoQuiz Vimaru
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Tự động trả lời trắc nghiệm Vimaru
// @author       You
// @match        https://hoctructuyen.vimaru.edu.vn/*
// @grant        GM_xmlhttpRequest
// @connect      ollama.com
// ==/UserScript==

(async () => {
  const API_KEY = "4c9fe6685c1f4a49a15c6490664b0ce5.JdGHwHx4qr_fMz1TKkKsZMYy";
  const MODEL = "qwen3-coder:480b-cloud";
  const SCAN_INTERVAL = 500;

  const log = (msg) => console.log(`[AutoQuiz] ${msg}`);

  // ===== CHỜ ELEMENT =====
  function waitForElement(selector, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) { clearInterval(timer); resolve(el); }
        else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error(`Timeout: ${selector}`));
        }
      }, SCAN_INTERVAL);
      log(`Đang chờ: ${selector}`);
    });
  }

  // ===== THÊM DẤU CHẤM =====
  function addDot(labelEl) {
    if (!labelEl || labelEl.innerText.trim().endsWith(".")) return;
    const textNodes = [...labelEl.childNodes].filter(n => n.nodeType === Node.TEXT_NODE);
    if (textNodes.length) {
      const last = textNodes[textNodes.length - 1];
      last.textContent = last.textContent.trimEnd() + ".";
    } else {
      labelEl.appendChild(document.createTextNode("."));
    }
  }

  // ===== GỌI OLLAMA: câu có choices → trả về index (0-based) =====
  function callOllamaChoices(question, choices) {
    return new Promise((resolve, reject) => {
      const choiceText = choices.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
      const prompt =
        `Bạn là hệ thống trả lời trắc nghiệm.\n` +
        `- Chọn tất cả đáp án đúng\n` +
        `- Trả lời CHỈ gồm các số thứ tự cách nhau bằng dấu phẩy (ví dụ: 1, 3). KHÔNG giải thích gì thêm.\n\n` +
        `${question}\n\n${choiceText}`;

      GM_xmlhttpRequest({
        method: "POST",
        url: "https://ollama.com/api/chat",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        data: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          stream: false
        }),
        timeout: 30000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            const raw = data?.message?.content || "";
            log(`AI: ${raw}`);
            const matched = raw.match(/\d+/g);
            const indices = matched
              ? [...new Set(matched.map(n => parseInt(n) - 1).filter(n => n >= 0 && n < choices.length))]
              : [];
            resolve(indices);
          } catch (e) { reject(new Error("Lỗi parse JSON")); }
        },
        onerror: () => reject(new Error("Request thất bại")),
        ontimeout: () => reject(new Error("Timeout"))
      });
    });
  }

  // ===== GỌI OLLAMA: câu không có choices → trả về text =====
  function callOllamaFree(question) {
    return new Promise((resolve, reject) => {
      const prompt =
        `Bạn là trợ lý học tập. Trả lời ngắn gọn, súc tích bằng tiếng Việt.\n\n` +
        `Câu hỏi: ${question}`;

      GM_xmlhttpRequest({
        method: "POST",
        url: "https://ollama.com/api/chat",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        data: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          stream: false
        }),
        timeout: 30000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            resolve(data?.message?.content || "");
          } catch (e) { reject(new Error("Lỗi parse JSON")); }
        },
        onerror: () => reject(new Error("Request thất bại")),
        ontimeout: () => reject(new Error("Timeout"))
      });
    });
  }

  // ===== REVIEW MODE: đọc class correct từ DOM =====
  function processReview() {
    log("REVIEW mode...");
    document.querySelectorAll(".que.multichoice").forEach((queEl, idx) => {
      queEl.querySelectorAll(".answer div.correct label").forEach(labelEl => {
        addDot(labelEl);
        log(`Câu ${idx + 1}: ✓ ${labelEl.innerText.trim()}`);
      });
    });
    log("Xong!");
  }

  // ===== ATTEMPT MODE: gọi AI =====
  async function processAttempt() {
    log("ATTEMPT mode - gọi AI...");
    const questions = document.querySelectorAll(".que.multichoice");
    log(`Tìm thấy ${questions.length} câu`);

    for (let i = 0; i < questions.length; i++) {
      const queEl = questions[i];
      const question = queEl.querySelector(".qtext")?.innerText?.trim();
      if (!question) continue;

      const labelEls = queEl.querySelectorAll(".answer [for]");

      // ── Có choices ──
      if (labelEls.length > 0) {
        const choices = [];
        labelEls.forEach(labelEl => {
          choices.push({ text: labelEl.innerText.trim(), el: labelEl });
        });

        log(`Câu ${i + 1} [${choices.length} lựa chọn]: ${question.substring(0, 50)}`);
        try {
          const indices = await callOllamaChoices(question, choices);
          log(`→ index: [${indices.join(", ")}]`);
          choices.forEach((c, idx) => {
            if (indices.includes(idx)) addDot(c.el);
          });
        } catch (e) {
          log(`Lỗi câu ${i + 1}: ${e.message}`);
        }

      // ── Không có choices ──
      } else {
        log(`Câu ${i + 1} [tự luận]: ${question.substring(0, 50)}`);
        try {
          const answer = await callOllamaFree(question);
          log(`AI: ${answer}`);

          const qTextEl = queEl.querySelector(".qtext");
          if (qTextEl && !queEl.querySelector(".autoquiz-answer")) {
            const div = document.createElement("div");
            div.className = "autoquiz-answer";
            div.style.cssText = "margin-top:8px;padding:8px;border-left:3px solid #1976d2;background:#e3f2fd;border-radius:4px;font-size:0.95em;white-space:pre-wrap;";
            div.textContent = `💡 ${answer}`;
            qTextEl.insertAdjacentElement("afterend", div);
          }
        } catch (e) {
          log(`Lỗi câu ${i + 1}: ${e.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }
    log("Xong!");
  }

  // ===== ENTRY POINT =====
  try {
    await waitForElement("#mod_quiz_navblock_title");
    if (location.href.includes("review.php")) {
      processReview();
    } else {
      await processAttempt();
    }
  } catch (e) {
    log(`Lỗi: ${e.message}`);
  }
})();
