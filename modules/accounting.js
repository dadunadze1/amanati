export function renderAccounting(el) {
  el.innerHTML = `
    <h3>ბუღალტრული აღრიცხვა</h3>
    <input placeholder="ოპერაციის სახელი" />
    <input type="number" placeholder="თანხა" />
    <select><option>შემოსავალი</option><option>ხარჯი</option></select>
    <button class="small-btn">ჩაწერა</button>
    <p>Firestore collection: <b>accounting</b></p>
  `;
}
