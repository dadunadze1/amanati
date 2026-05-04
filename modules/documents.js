export function renderDocuments(el) {
  el.innerHTML = `
    <h3>დოკუმენტების ავტომატური შექმნა</h3>
    <p>სატესტო ჩონჩხი:</p>
    <ul>
      <li>ინვოისი</li>
      <li>მიღება-ჩაბარების აქტი</li>
      <li>კურიერის დღიური ანგარიში</li>
    </ul>
    <p>სერვერულ ვერსიაში PDF გენერაცია დაემატება Cloud Functions-ით ან backend API-ით.</p>
  `;
}
