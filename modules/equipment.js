export function renderEquipment(el) {
  el.innerHTML = `
    <h3>აღჭურვილობის მონაცემების მართვა</h3>
    <input placeholder="აღჭურვილობის სახელი" />
    <input placeholder="სერიული ნომერი" />
    <input placeholder="ვისზეა მიბმული" />
    <button class="small-btn">დამატება</button>
    <p>Firestore collection: <b>equipment</b></p>
  `;
}
