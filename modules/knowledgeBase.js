export function renderKnowledgeBase(el) {
  el.innerHTML = `
    <h3>ცოდნის ბაზა</h3>
    <input placeholder="სათაური" />
    <textarea placeholder="ინსტრუქცია / პროცედურა"></textarea>
    <button class="small-btn">შენახვა</button>
    <p>აქ შეინახება წესები, ინსტრუქციები და შიდა ცოდნა.</p>
  `;
}
