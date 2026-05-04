// ==UserScript==
// @name         AutoQuiz Vimaru
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  Tự động trả lời trắc nghiệm Vimaru (có chế độ Clipboard)
// @author       You
// @match        https://hoctructuyen.vimaru.edu.vn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      llm.chiasegpu.vn
// ==/UserScript==

(async () => {
  const API_KEY   = "sk-20816134b3ec5487f95b5bb9166e0d82c8fe6431d28e718f76cc3d7d9588ea47";
  const MODEL     = "cx/gpt-5.4";
  const SCAN_INTERVAL = 500;

  const ANSWER_PREFIX = "✅ANS: ";

  const log = (msg) => console.log(`[AutoQuiz] ${msg}`);

  // ─────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────

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

  // ─────────────────────────────────────────────
  // SYSTEM PROMPT PREFIXES (gộp vào user message)
  // ─────────────────────────────────────────────

  const PREFIX_MCQ = `Bạn là chuyên gia về Mạng máy tính (Computer Networks), thành thạo các chủ đề:
- Mô hình OSI và TCP/IP (các tầng, giao thức, chức năng)
- Địa chỉ IP, subnet mask, CIDR, VLSM, NAT/PAT
- Giao thức định tuyến: RIP, OSPF, EIGRP, BGP
- Switching: VLAN, STP, Trunk, EtherChannel
- Giao thức ứng dụng: HTTP/HTTPS, DNS, DHCP, FTP, SMTP, SSH, Telnet
- Bảo mật mạng: Firewall, ACL, VPN, IDS/IPS
- Wireless: 802.11a/b/g/n/ac/ax, WPA/WPA2/WPA3
- IPv6, QoS, MPLS, SDN

NGUYÊN TẮC:
- Chọn TẤT CẢ đáp án đúng (có thể nhiều hơn 1)
- Ưu tiên kiến thức chuẩn theo tài liệu Cisco, RFC, và giáo trình Kurose/Tanenbaum
- Trả lời CHỈ gồm các số thứ tự cách nhau bằng dấu phẩy. KHÔNG giải thích, KHÔNG thêm chữ nào khác.
- Ví dụ hợp lệ: "2" hoặc "1, 3" hoặc "1, 2, 4"

Câu hỏi và đáp án:
`;

  const PREFIX_FREE = `Bạn là chuyên gia Mạng máy tính (Computer Networks). Trả lời bằng tiếng Việt, chính xác theo chuẩn Cisco và RFC. Không dùng markdown.

Câu hỏi: `;

  const PREFIX_CLIPBOARD = `Bạn là chuyên gia Mạng máy tính (Computer Networks), thành thạo OSI/TCP-IP, IP/Subnet/CIDR/VLSM/NAT, định tuyến (RIP/OSPF/EIGRP/BGP), Switching (VLAN/STP/Trunk), giao thức ứng dụng (DNS/DHCP/HTTP/FTP/SMTP/SSH), bảo mật (Firewall/ACL/VPN/IDS), Wireless (802.11/WPA), IPv6, QoS, MPLS. Kiến thức chuẩn theo Cisco, RFC, Kurose, Tanenbaum.
Trả lời bằng tiếng Việt, đủ ý, không dùng markdown.

`;

  // ─────────────────────────────────────────────
  // AI CALLS
  // ─────────────────────────────────────────────

  function callOllamaChoices(question, choices) {
    return new Promise((resolve, reject) => {
      const choiceText = choices.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
      const prompt = `${PREFIX_MCQ}${question}\n\n${choiceText}`;

      GM_xmlhttpRequest({
        method: "POST",
        url: "https://llm.chiasegpu.vn/v1/chat/completions",
        headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        data: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "user", content: prompt }
          ],
          stream: false
        }),
        timeout: 30000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            const raw = data?.choices?.[0]?.message?.content
                     || data?.message?.content
                     || "";
            log(`AI choices: ${raw}`);
            const matched = raw.match(/\d+/g);
            const indices = matched
              ? [...new Set(matched.map(n => parseInt(n) - 1).filter(n => n >= 0 && n < choices.length))]
              : [];
            resolve(indices);
          } catch (e) { reject(new Error("Lỗi parse JSON")); }
        },
        onerror:   () => reject(new Error("Request thất bại")),
        ontimeout: () => reject(new Error("Timeout"))
      });
    });
  }

  function callOllamaFree(question) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: "https://llm.chiasegpu.vn/v1/chat/completions",
        headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        data: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "user", content: `${PREFIX_FREE}${question}` }
          ],
          stream: false
        }),
        timeout: 30000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            resolve(
              data?.choices?.[0]?.message?.content
              || data?.message?.content
              || ""
            );
          } catch (e) { reject(new Error("Lỗi parse JSON")); }
        },
        onerror:   () => reject(new Error("Request thất bại")),
        ontimeout: () => reject(new Error("Timeout"))
      });
    });
  }

  function callOllamaClipboard(question) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: "https://llm.chiasegpu.vn/v1/chat/completions",
        headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        data: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "user", content: `${PREFIX_CLIPBOARD}${question}` }
          ],
          stream: false
        }),
        timeout: 45000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            resolve(
              data?.choices?.[0]?.message?.content
              || data?.message?.content
              || ""
            );
          } catch (e) { reject(new Error("Lỗi parse JSON")); }
        },
        onerror:   () => reject(new Error("Request thất bại")),
        ontimeout: () => reject(new Error("Timeout"))
      });
    });
  }

  // ─────────────────────────────────────────────
  // REVIEW MODE
  // ─────────────────────────────────────────────

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

  // ─────────────────────────────────────────────
  // ATTEMPT MODE
  // ─────────────────────────────────────────────

  async function processAttempt() {
    log("ATTEMPT mode - gọi AI...");
    const questions = document.querySelectorAll(".que.multichoice");
    log(`Tìm thấy ${questions.length} câu`);

    for (let i = 0; i < questions.length; i++) {
      const queEl   = questions[i];
      const question = queEl.querySelector(".qtext")?.innerText?.trim();
      if (!question) continue;

      const labelEls = queEl.querySelectorAll(".answer [for]");

      if (labelEls.length > 0) {
        const choices = [];
        labelEls.forEach(labelEl => {
          choices.push({ text: labelEl.innerText.trim(), el: labelEl });
        });

        log(`Câu ${i + 1} [${choices.length} lựa chọn]: ${question.substring(0, 60)}`);
        try {
          const indices = await callOllamaChoices(question, choices);
          log(`→ index: [${indices.join(", ")}]`);
          choices.forEach((c, idx) => {
            if (indices.includes(idx)) addDot(c.el);
          });
        } catch (e) {
          log(`Lỗi câu ${i + 1}: ${e.message}`);
        }

      } else {
        log(`Câu ${i + 1} [tự luận]: ${question.substring(0, 60)}`);
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

  // ─────────────────────────────────────────────
  // CLIPBOARD MODE
  // ─────────────────────────────────────────────

  async function processClipboard() {
    log("CLIPBOARD mode - đang đọc clipboard...");

    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      log(`Không đọc được clipboard: ${e.message}`);
      return;
    }

    const trimmed = text.trim();

    if (!trimmed) {
      log("Clipboard trống, bỏ qua.");
      return;
    }
    if (trimmed.startsWith(ANSWER_PREFIX)) {
      log("Clipboard đã là câu trả lời, bỏ qua.");
      return;
    }

    log(`Câu hỏi từ clipboard: ${trimmed.substring(0, 80)}...`);

    try {
      const answer = await callOllamaClipboard(trimmed);
      log(`AI trả lời: ${answer.substring(0, 120)}`);
      GM_setClipboard(`${ANSWER_PREFIX}${answer}`, "text");
      log("Đã ghi câu trả lời vào clipboard.");
    } catch (e) {
      log(`Lỗi clipboard mode: ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // CLIPBOARD WATCHER
  // ─────────────────────────────────────────────

  function startClipboardWatcher(intervalMs = 2000) {
    let lastSeen = "";

    const tick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        const trimmed = text.trim();

        if (
          trimmed &&
          trimmed !== lastSeen &&
          !trimmed.startsWith(ANSWER_PREFIX)
        ) {
          lastSeen = trimmed;
          log(`[Watcher] Phát hiện câu hỏi mới: ${trimmed.substring(0, 60)}`);

          try {
            const answer = await callOllamaClipboard(trimmed);
            const output = `${ANSWER_PREFIX}${answer}`;
            GM_setClipboard(output, "text");
            lastSeen = output;
            log(`[Watcher] Đã ghi câu trả lời vào clipboard.`);
          } catch (e) {
            log(`[Watcher] Lỗi AI: ${e.message}`);
          }
        }
      } catch {
        // Clipboard permission bị từ chối hoặc tab mất focus — im lặng
      }
    };

    setInterval(tick, intervalMs);
    log(`Clipboard Watcher đang chạy (mỗi ${intervalMs}ms)...`);
  }

  // ─────────────────────────────────────────────
  // ENTRY POINT
  // ─────────────────────────────────────────────

  try {
    await waitForElement("#mod_quiz_navblock_title");

    if (location.href.includes("review.php")) {
      processReview();
      startClipboardWatcher(2000);
    } else {
      Promise.all([
        processAttempt(),
        Promise.resolve(startClipboardWatcher(2000))
      ]);
    }

  } catch (e) {
    log(`Lỗi: ${e.message}`);
  }
})();
