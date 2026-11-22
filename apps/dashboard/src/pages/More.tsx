import { useStructure } from '../data';
import { Link } from '../router';

const ITEMS = [
  { to: '/semana', icon: '📊', label: 'Semana', hint: 'Resumen y revisión semanal' },
  { to: '/a', icon: '🗂️', label: 'Áreas', hint: 'Registros y cuestionarios de cada área' },
  { to: '/propuestas', icon: '💡', label: 'Propuestas de Claude', hint: 'Cambios que esperan tu aprobación' },
  { to: '/ajustes', icon: '⚙️', label: 'Ajustes', hint: 'Planes, contraseña, conector y datos' },
];

export function More() {
  const s = useStructure();
  return (
    <main>
      <header className="page-head"><h1>Más</h1></header>
      <ul className="area-list">
        {ITEMS.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className="area-tile">
              <span className="icon" aria-hidden="true">{i.icon}</span>
              <span className="grow">{i.label}<span className="muted small block">{i.hint}</span></span>
              {i.to === '/propuestas' && s.pendingProposals ? <span className="badge">{s.pendingProposals}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
