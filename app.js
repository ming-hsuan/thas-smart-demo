// app.js

window.addEventListener("load", () => {
  const statusEl = document.getElementById("app-status");
  const patientInfoEl = document.getElementById("patient-info");
  const disTextEl = document.getElementById("dis-text");
  const btnShowAnswer = document.getElementById("btn-show-answer");
  const answerBlockEl = document.getElementById("answer-block");

  let answersMap = {};
  let smartClient = null;
  let demoCases = [];     // [{ index, patientId, observation, disPreview }]
  let currentPatientId = null;

  // 1. 同時載入 demo_icd_answers.json + 等待 SMART ready
  Promise.all([
    fetch("./demo_icd_answers.json")
      .then((resp) => {
        if (!resp.ok) throw new Error("demo_icd_answers.json 載入失敗");
        return resp.json();
      })
      .catch((err) => {
        console.warn("載入 demo_icd_answers.json 失敗：", err);
        return {};
      }),
    FHIR.oauth2.ready()
  ])
    .then(([answers, client]) => {
      answersMap = answers || {};
      smartClient = client;

      statusEl.textContent = "SMART 授權成功，正在從 FHIR 載入 Demo 範例…";

      // 2. 不用 client.patient，直接搜尋 Observation（code=11506-3）
      const obsQuery =
        "Observation?code=11506-3&_sort=-_lastUpdated&_count=200";

      return client.request(obsQuery).then((bundle) => {
        const entries = bundle.entry || [];
        demoCases = [];

        entries.forEach((e) => {
          const obs = e.resource;
          if (!obs || obs.resourceType !== "Observation") return;
          if (!obs.subject || !obs.subject.reference) return;

          const ref = obs.subject.reference; // 例如 "Patient/demo-000001"
          if (!ref.startsWith("Patient/")) return;

          const patientId = ref.split("/")[1]; // demo-000001

          // 只挑有在 answersMap 裡的 demo-xxxxx
          if (!answersMap[patientId]) return;

          const disText = obs.valueString || "";
          const disPreview = disText.slice(0, 80).replace(/\s+/g, " ");

          demoCases.push({
            patientId,
            observation: obs,
            disPreview,
          });
        });

        if (demoCases.length === 0) {
          statusEl.textContent =
            "已連線 FHIR，但找不到符合條件的 Demo Observation。\n" +
            "請確認 upload_demo_dataset_with_answers.py 有成功匯入，且 code=11506-3。";
          patientInfoEl.textContent = "（沒有找到 Demo 資料）";
          return;
        }

        renderDemoList(patientInfoEl, demoCases);
        statusEl.textContent =
          "已載入 " + demoCases.length + " 筆 Demo 範例，請點選下方清單中的某一列。";
      });
    })
    .catch((err) => {
      console.error(err);
      statusEl.textContent = "SMART 授權或資料讀取失敗，請開 F12 看 console。";
    });

  // 3. 顯示標準答案（以 CSV assistant 欄位為 Demo）
  btnShowAnswer.addEventListener("click", () => {
    if (!currentPatientId) {
      answerBlockEl.textContent = "尚未取得病人 ID，請先從上方清單選一筆 Demo。";
      return;
    }

    const rec = answersMap[currentPatientId];

    if (!rec) {
      answerBlockEl.textContent =
        "此病人 ID（" +
        currentPatientId +
        "）不在 demo 答案清單中。\n" +
        "（可能是沙盒內建病人或非 CSV Demo 資料。）";
      return;
    }

    const assistant = rec.assistant || "";
    const preview = rec.dis_preview || "";

    answerBlockEl.textContent =
      "（Demo）此區顯示 CSV assistant 欄位內容，" +
      "目前暫代 AI 建議用於展示流程。\n\n" +
      "病摘前 80 字（供比對）：\n" +
      preview +
      "\n\n" +
      "標準答案（原始字串）：\n" +
      assistant;
  });

  // ==== 小工具：畫出 Demo 清單，並處理點選 ====

  function renderDemoList(container, cases) {
    let html = "<table border='1' cellspacing='0' cellpadding='4' style='width:100%; border-collapse:collapse;'>";
    html += "<thead><tr><th>#</th><th>病人 ID</th><th>病摘預覽</th><th>操作</th></tr></thead><tbody>";

    cases.forEach((c, idx) => {
      html +=
        "<tr>" +
        "<td>" + (idx + 1) + "</td>" +
        "<td>" + c.patientId + "</td>" +
        "<td>" + escapeHtml(c.disPreview) + "</td>" +
        "<td><button type='button' data-index='" + idx + "'>載入</button></td>" +
        "</tr>";
    });

    html += "</tbody></table>";

    container.innerHTML = html;

    // 綁定每個「載入」按鈕
    const buttons = container.querySelectorAll("button[data-index]");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        const selected = demoCases[idx];
        if (!selected) return;

        loadDemoCase(selected);
      });
    });
  }

  function loadDemoCase(selected) {
    if (!smartClient) return;
    const patientId = selected.patientId;
    const obs = selected.observation;

    statusEl.textContent = "正在載入病人 " + patientId + " 資料…";
    currentPatientId = patientId;

    // 讀取 Patient/{id}
    smartClient
      .request("Patient/" + encodeURIComponent(patientId))
      .then((patient) => {
        renderPatientDetail(patientInfoEl, patient, selected);
        disTextEl.value = obs.valueString || "";
        statusEl.textContent = "已載入病人 " + patientId + " 的 Demo 病摘。";
      })
      .catch((err) => {
        console.error(err);
        patientInfoEl.textContent =
          "讀取 Patient/" + patientId + " 失敗，請開 console 查看錯誤。";
        disTextEl.value = obs.valueString || "";
        statusEl.textContent =
          "已載入病摘，但讀取 Patient/" + patientId + " 失敗。";
      });
  }

  function renderPatientDetail(container, patient, selected) {
    if (!patient) {
      container.textContent = "未取得病人資料。";
      return;
    }

    const name =
      (patient.name && patient.name[0] && (patient.name[0].text || "")) || "";
    const gender = patient.gender || "";
    const birthDate = patient.birthDate || "";
    const identifier =
      patient.identifier && patient.identifier[0]
        ? patient.identifier[0].value
        : "";
    const id = patient.id || "";

    container.innerHTML = `
      <div><strong>FHIR Resource ID：</strong>${id}</div>
      <div><strong>姓名：</strong>${name || "（未提供）"}</div>
      <div><strong>性別：</strong>${gender || "（未提供）"}</div>
      <div><strong>出生日期：</strong>${birthDate || "（未提供）"}</div>
      <div><strong>測試用識別碼（identifier）：</strong>${identifier || "（未提供）"}</div>
      <hr/>
      <div><strong>這筆 Demo 病摘預覽：</strong>${escapeHtml(
        selected.disPreview
      )}</div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
});
