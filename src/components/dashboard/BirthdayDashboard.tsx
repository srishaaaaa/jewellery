import React, { useState } from 'react'
import BirthdayView from './BirthdayView'
import AnniversaryView from './AnniversaryView'
import JewelleryCustomerProfile from './JewelleryCustomerProfile'

type TabType = 'birthday' | 'anniversary' | 'profile'

export default function BirthdayDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('birthday')

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-[#E5E7EB] overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveTab('birthday')}
          className={`px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${
            activeTab === 'birthday'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[#6B7280] hover:text-[#111111]'
          }`}
        >
          🎂 Birthdays
        </button>
        <button
          onClick={() => setActiveTab('anniversary')}
          className={`px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${
            activeTab === 'anniversary'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[#6B7280] hover:text-[#111111]'
          }`}
        >
          💍 Anniversaries
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${
            activeTab === 'profile'
              ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
              : 'text-[#6B7280] hover:text-[#111111]'
          }`}
        >
          💎 Jewellery Profile
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'birthday' && <BirthdayView />}
      {activeTab === 'anniversary' && <AnniversaryView />}
      {activeTab === 'profile' && <JewelleryCustomerProfile />}
    </div>
  )
}
