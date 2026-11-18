/* Registration page logic */
applyBranding();
document.getElementById("year").textContent = new Date().getFullYear();

const form = document.getElementById("registerForm");
const submitBtn = document.getElementById("submitBtn");
const inputs = {
  name: document.getElementById("name"),
  aadhaar: document.getElementById("aadhaar"),
  phone: document.getElementById("phone"),
  dob: document.getElementById("dob"),
};
const consent = document.getElementById("consent");
const touched = new Set();

// Date limits: no future dates, nothing older than 120 years
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
inputs.dob.max = iso(today);
inputs.dob.min = iso(new Date(today.getFullYear() - 120, today.getMonth(), today.getDate()));

/* ---------- Validators: return "" when valid, else an error message ---------- */
const validators = {
  name(v) {
    v = v.trim();
    if (!v) return "Please enter your full name.";
    if (v.length < 3) return "Name looks too short.";
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(v)) return "Use letters, spaces, dots or hyphens only.";
    return "";
  },
  aadhaar(v) {
    const d = onlyDigits(v);
    if (!d) return "Please enter your Aadhaar number.";
    if (d.length < 12) return `Aadhaar must be 12 digits (${d.length}/12).`;
    if (!isValidAadhaar(d)) return "This doesn't look like a valid Aadhaar number. Please check.";
    return "";
  },
  phone(v) {
    const d = onlyDigits(v);
    if (!d) return "Please enter your mobile number.";
    if (d.length < 10) return `Mobile number must be 10 digits (${d.length}/10).`;
    if (!isValidPhone(d)) return "Indian mobile numbers start with 6, 7, 8 or 9.";
    return "";
  },
  dob(v) {
    if (!v) return "Please select your date of birth.";
    const age = calcAge(v);
    if (isNaN(age)) return "Please enter a valid date.";
    if (new Date(v + "T00:00:00") > today) return "Date of birth can't be in the future.";
    if (age > 120) return "Please check the year.";
    return "";
  },
};

function hintFor(key, value) {
  if (key === "dob" && value) {
    const age = calcAge(value);
    return `Age: ${age} ${age === 1 ? "year" : "years"}`;
  }
  return "";
}

function setFieldState(key, showError) {
  const input = inputs[key];
  const field = input.closest(".field");
  const msg = document.getElementById(`${key}-msg`);
  const error = validators[key](input.value);

  field.classList.remove("is-valid", "is-invalid");
  input.removeAttribute("aria-invalid");

  if (error && showError) {
    field.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    msg.textContent = error;
  } else if (!error) {
    field.classList.add("is-valid");
    msg.textContent = hintFor(key, input.value);
  } else {
    msg.textContent = "";
  }
  return !error;
}

/* ---------- Input masks (keep caret in place while formatting) ---------- */
function maskInput(input, formatter, maxDigits) {
  input.addEventListener("input", () => {
    const caret = input.selectionStart;
    const digitsBeforeCaret = onlyDigits(input.value.slice(0, caret)).length;
    const digits = onlyDigits(input.value).slice(0, maxDigits);
    input.value = formatter(digits);
    let pos = 0, seen = 0;
    while (pos < input.value.length && seen < digitsBeforeCaret) {
      if (/\d/.test(input.value[pos])) seen++;
      pos++;
    }
    input.setSelectionRange(pos, pos);
  });
}
maskInput(inputs.aadhaar, formatAadhaar, 12);
maskInput(inputs.phone, (d) => d.replace(/^(\d{5})(\d)/, "$1 $2"), 10);

/* ---------- Live validation ---------- */
Object.keys(inputs).forEach((key) => {
  const input = inputs[key];
  input.addEventListener("blur", () => {
    if (input.value) touched.add(key);
    setFieldState(key, touched.has(key));
  });
  input.addEventListener("input", () => setFieldState(key, touched.has(key)));
  input.addEventListener("change", () => setFieldState(key, touched.has(key)));
});

consent.addEventListener("change", () => {
  if (consent.checked) document.getElementById("consent-msg").textContent = "";
});

/* Hide / show Aadhaar while typing (privacy in public places) */
const toggleBtn = document.getElementById("toggleAadhaar");
toggleBtn.addEventListener("click", () => {
  const hidden = inputs.aadhaar.classList.toggle("masked");
  toggleBtn.classList.toggle("off", hidden);
  toggleBtn.setAttribute("aria-label", hidden ? "Show Aadhaar number" : "Hide Aadhaar number");
});

/* ---------- Submit ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  let firstInvalid = null;
  Object.keys(inputs).forEach((key) => {
    touched.add(key);
    if (!setFieldState(key, true) && !firstInvalid) firstInvalid = inputs[key];
  });
  if (!consent.checked) {
    document.getElementById("consent-msg").textContent = "Please confirm to continue.";
    firstInvalid = firstInvalid || consent;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
    return;
  }

  // Bot filled the hidden field — pretend success, send nothing
  if (document.getElementById("website").value) return showSuccess("Member", "—");

  const data = {
    name: inputs.name.value.trim().replace(/\s+/g, " "),
    aadhaar: onlyDigits(inputs.aadhaar.value),
    phone: onlyDigits(inputs.phone.value),
    dob: inputs.dob.value,
  };

  setLoading(true);
  try {
    const res = await callApi({ action: "register", data });
    if (!res.ok) throw new Error(res.error || "Registration failed.");
    showSuccess(data.name, res.memberId);
  } catch (err) {
    toast(err.message === "Failed to fetch" ? "Network error. Check your connection and try again." : err.message, "error");
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.querySelector(".btn-label").textContent = on ? "Registering…" : "Register";
}

function showSuccess(name, memberId) {
  document.getElementById("successName").textContent = name.split(" ")[0];
  document.getElementById("memberId").textContent = memberId;
  document.getElementById("formCard").hidden = true;
  const card = document.getElementById("successCard");
  card.hidden = false;
  card.querySelector("h2").focus?.();
}

document.getElementById("copyId").addEventListener("click", async (e) => {
  const id = document.getElementById("memberId").textContent;
  try {
    await navigator.clipboard.writeText(id);
    e.target.textContent = "Copied!";
    setTimeout(() => (e.target.textContent = "Copy"), 1800);
  } catch {
    toast("Couldn't copy. Please note it down.", "error");
  }
});

document.getElementById("registerAnother").addEventListener("click", () => {
  form.reset();
  touched.clear();
  Object.keys(inputs).forEach((k) => {
    inputs[k].closest(".field").classList.remove("is-valid", "is-invalid");
    document.getElementById(`${k}-msg`).textContent = "";
  });
  document.getElementById("successCard").hidden = true;
  document.getElementById("formCard").hidden = false;
  inputs.name.focus();
});
