// app.js

window.addEventListener("load", () => {
  const statusEl = document.getElementById("app-status");
  const patientInfoEl = document.getElementById("patient-info");
  const disTextEl = document.getElementById("dis-text");
  const btnShowAnswer = document.getElementById("btn-show-answer");
  const answerBlockEl = document.getElementById("answer-block");

  let answersMap = {};
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
        return {}; // 失敗時給空物件，至少不會整個炸掉
      }),
    FHIR.oauth2.ready()
  ])
    .then(([answers, client]) => {
      answersMap = answers || {};
      statusEl.textContent = "SMART 授權成功，正在讀取病人與出院診斷…";

      // 2. 讀病人資料
      return client.patient.read().then((patient) => {
        currentPatientId = patient.id;
        renderPatient(patientInfoEl, patient);

        // 3. 依病人 ID 讀取此人的 11506-3 Observation（最新一筆）
        const obsQuery =
          "Observation?patient=" +
          encodeURIComponent(patient.id) +
          "&code=11506-3&_sort=-_lastUpdated&_count=1";

        return client.request(obsQuery).then((bundle) => {
          if (!bundle.entry || bundle.entry.length === 0) {
            statusEl.textContent =
              "找不到此病人的 Observation（code=11506-3）。";
            disTextEl.value = "";
            return;
          }

          const obs = bundle.entry[0].resource;
          console.log("Loaded Observation:", obs);
          disTextEl.value = obs.valueString || "";
          statusEl.textContent = "資料載入完成。";
        });
      });
    })
    .catch((err) => {
      console.error(err);
      statusEl.textContent = "SMART 授權或資料讀取失敗，請開 F12 看 console。";
    });

  // 4. 按鈕：顯示此病人的「標準答案（assistant 欄位）」
  btnShowAnswer.addEventListener("click", () => {
    if (!currentPatientId) {
      answerBlockEl.textContent = "尚未取得病人 ID，請稍候重試。";
      return;
    }

    const rec = answersMap[currentPatientId];

    if (!rec) {
      answerBlockEl.textContent =
        "此病人 ID（" +
        currentPatientId +
        "）不在 demo 答案清單中。\n" +
        "（可能是沙盒內建病人或非 demo-0000xx 資料。）";
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
});

function renderPatient(container, patient) {
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
    <div>FHIR Resource ID：${id}</div>
    <div>姓名：${name || "（未提供）"}</div>
    <div>性別：${gender || "（未提供）"}</div>
    <div>出生日期：${birthDate || "（未提供）"}</div>
    <div>測試用識別碼（identifier）：${identifier || "（未提供）"}</div>
  `;
}

