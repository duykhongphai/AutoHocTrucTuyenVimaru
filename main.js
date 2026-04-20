// ==UserScript==
// @name         AutoQuiz Vimaru
// @namespace    http://tampermonkey.net/
// @version      4.0
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

  function callOllama(prompt) {
    return new Promise((resolve, reject) => {
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
          } catch (e) {
            reject(new Error("Lỗi parse JSON"));
          }
        },
        onerror: () => reject(new Error("Request thất bại")),
        ontimeout: () => reject(new Error("Timeout"))
      });
    });
  }

  // ===== REVIEW: đọc class correct =====
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

  // ===== ATTEMPT: có choices → gọi AI chọn đáp án =====
  async function processAttempt() {
    log("ATTEMPT mode - gọi AI...");
    const questions = document.querySelectorAll(".que.multichoice");
    log(`Tìm thấy ${questions.length} câu`);

    for (let i = 0; i < questions.length; i++) {
      const queEl = questions[i];
      const question = queEl.querySelector(".qtext")?.innerText?.trim();
      if (!question) continue;

      const labelEls = queEl.querySelectorAll(".answer [for]");

      // ── Có đáp án → chọn đúng rồi thêm dấu chấm ──
      if (labelEls.length > 0) {
        const choices = [];
        labelEls.forEach((labelEl, j) => {
          choices.push({ label: String.fromCharCode(97 + j), text: labelEl.innerText.trim(), el: labelEl });
        });

        const choiceText = choices.map(c => `${c.label}. ${c.text}`).join("\n");
        const prompt =
          `Bạn là hệ thống trả lời trắc nghiệm.\n` +
          `- Nếu câu hỏi cho phép nhiều đáp án → chọn tất cả đáp án đúng\n` +
          `- Trả lời CHỈ gồm các chữ cái cách nhau bằng dấu phẩy (ví dụ: a, d). KHÔNG giải thích.\n\n` +
          `${question}\n\nSelect one or more:\n${choiceText}`;

        log(`Câu ${i + 1} [có đáp án]: ${question.substring(0, 50)}`);
        try {
          const raw = await callOllama(prompt);
          log(`AI: ${raw}`);
          const correct = [...new Set((raw.toLowerCase().match(/\b[a-z]\b/g) || []))];
          log(`→ [${correct.join(", ")}]`);
          choices.forEach(c => { if (correct.includes(c.label)) addDot(c.el); });
        } catch (e) {
          log(`Lỗi câu ${i + 1}: ${e.message}`);
        }

      // ── Không có đáp án → hỏi AI rồi chèn câu trả lời vào trang ──
      } else {
        const prompt =
          `Bạn là trợ lý học tập. Trả lời ngắn gọn, súc tích bằng tiếng Việt.\n\n` +
          `Câu hỏi: ${question}`;

        log(`Câu ${i + 1} [không có đáp án]: ${question.substring(0, 50)}`);
        try {
          const answer = await callOllama(prompt);
          log(`AI: ${answer}`);

          // Chèn câu trả lời ngay sau .qtext
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
