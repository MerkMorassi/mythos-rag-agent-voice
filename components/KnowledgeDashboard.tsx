import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { VectorRecord } from '../types';

interface KnowledgeDashboardProps {
  vectors: VectorRecord[];
}

export const KnowledgeDashboard: React.FC<KnowledgeDashboardProps> = ({ vectors }) => {
  const chartData = useMemo(() => {
    // Group vectors by date
    const groups: Record<string, number> = {};
    vectors.forEach(v => {
      const date = new Date(v.timestamp).toLocaleDateString();
      groups[date] = (groups[date] || 0) + 1;
    });

    return Object.entries(groups)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [vectors]);

  return (
    <div className="section-panel" style={{ height: '200px', padding: '1rem', background: '#0a0a0a', border: '1px solid #333' }}>
      <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '0.5rem', fontWeight: 'bold' }}>INGESTION ACTIVITY (VECTOR DENSITY)</div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="date" stroke="#666" fontSize={10} />
          <YAxis stroke="#666" fontSize={10} />
          <Tooltip 
            contentStyle={{ background: '#000', border: '1px solid #333' }}
            itemStyle={{ color: '#4ade80' }}
          />
          <Line type="monotone" dataKey="count" stroke="#4ade80" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
