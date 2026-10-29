import React, { useState } from 'react'
import BirthdayView from './BirthdayView'
import AnniversaryView from './AnniversaryView'
import MissingDatesView from './MissingDatesView'

type TabType = 'birthday' | 'anniversary' | 'missing'

export default function BirthdayDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('birthday')

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-black/10 overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveTab('birthday')}
          className={`px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${
            activeTab === 'birthday'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[#000000] hover:text-[#000000]'
          }`}
        >
          🎂 Birthdays
        </button>
        <button
          onClick={() => setActiveTab('anniversary')}
          className={`px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${
            activeTab === 'anniversary'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[#000000] hover:text-[#000000]'
          }`}
        >
          💍 Anniversaries
        </button>
        <button
          onClick={() => setActiveTab('missing')}
          className={`px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${
            activeTab === 'missing'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[#000000] hover:text-[#000000]'
          }`}
        >
          📋 No Dates Saved
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'birthday' && <BirthdayView />}
      {activeTab === 'anniversary' && <AnniversaryView />}
      {activeTab === 'missing' && <MissingDatesView />}
    </div>
  )
}
