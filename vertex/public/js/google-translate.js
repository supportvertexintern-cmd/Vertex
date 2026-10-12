// Google Translate widget bootstrap (app/layout.tsx). An external file
// rather than an inline script, so the CSP needs no 'unsafe-inline' (E3).
// It defines the widget's callback before loading Google's script, so the
// callback always exists when that script calls it; with 'strict-dynamic'
// the CSP trusts the script this one adds.
(function () {
  window.googleTranslateElementInit = function () {
    new window.google.translate.TranslateElement(
      { pageLanguage: "en", autoDisplay: false },
      "google_translate_element"
    );
  };
  var s = document.createElement("script");
  s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  s.async = true;
  document.head.appendChild(s);
})();
