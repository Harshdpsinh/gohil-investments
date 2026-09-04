import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const TYPE_COLORS = ['#0f766e', '#0ea5e9', '#d97706', '#059669', '#7c3aed', '#64748b']

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
    y: { grid: { color: 'rgba(148,163,184,0.1)' }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
  },
}

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12, color: '#94a3b8' } } },
  cutout: '65%',
}

export default function DashboardCharts({ byType = {}, monthly = [] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">Policies by Type</p>
        <div style={{ height: 180 }}>
          <Doughnut
            data={{ labels: Object.keys(byType), datasets: [{ data: Object.values(byType), backgroundColor: TYPE_COLORS, borderWidth: 2 }] }}
            options={DOUGHNUT_OPTS}
          />
        </div>
      </div>
      <div className="card">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">New Policies (6 months)</p>
        <div style={{ height: 180 }}>
          <Bar
            data={{ labels: monthly.map(m => m.label), datasets: [{ label: 'Policies', data: monthly.map(m => m.count), backgroundColor: '#0f766e', borderRadius: 4 }] }}
            options={CHART_OPTS}
          />
        </div>
      </div>
    </div>
  )
}
