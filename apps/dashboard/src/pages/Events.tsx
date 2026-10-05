import React, { useState } from 'react';
import { History, Terminal, Eye, Image as ImageIcon, ExternalLink, Filter } from 'lucide-react';
import { EventLog } from '../types';
import { formatDisplayDate } from '../utils/date';

interface EventsProps {
  events: EventLog[];
}

export const Events: React.FC<EventsProps> = ({ events }) => {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [selectedPayload, setSelectedPayload] = useState<any | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">Audit Event Stream</h2>
          <p className="text-sm text-gray-400 mt-1">
            Deterministic audit trail of all browser interactions, decisions, and outcomes.
          </p>
        </div>
        <span className="text-xs font-mono px-3 py-1 bg-gray-900 border border-gray-800 rounded-lg text-gray-400">
          {events.length} Events Logged
        </span>
      </div>

      {/* Events Timeline Feed */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/60 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-6">Timestamp</th>
                <th className="py-3.5 px-6">Event Code</th>
                <th className="py-3.5 px-6">Stage</th>
                <th className="py-3.5 px-6">Description</th>
                <th className="py-3.5 px-6 text-right">Artifacts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 text-xs">
              {events.length > 0 ? (
                events.map((ev) => {
                  const payloadObj = ev.payload_json || (ev as any).payload;
                  const displayTime = formatDisplayDate(ev.created_at || (ev as any).timestamp);
                  const displayDesc = ev.message || payloadObj?.message || payloadObj?.reason || (payloadObj ? JSON.stringify(payloadObj) : '—');
                  const displayStage = ev.stage || payloadObj?.stage || (ev as any).category || 'GLOBAL';
                  const screenshotPath = ev.screenshot_path || payloadObj?.screenshot_path;

                  return (
                    <tr key={ev.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="py-3.5 px-6 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                        {displayTime}
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="font-mono text-indigo-400 bg-indigo-950/40 border border-indigo-500/30 px-2 py-0.5 rounded text-[11px]">
                          {ev.event_code}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-gray-300 font-semibold text-[11px]">
                        {displayStage}
                      </td>
                      <td className="py-3.5 px-6 text-gray-300 max-w-md font-sans">
                        {displayDesc}
                      </td>
                      <td className="py-3.5 px-6 text-right space-x-2 whitespace-nowrap">
                        {screenshotPath && (
                          <button
                            onClick={() => setSelectedScreenshot(`/screenshots/${screenshotPath}`)}
                            className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-[11px] font-semibold cursor-pointer"
                          >
                            <ImageIcon className="w-3 h-3 text-indigo-400" />
                            <span>Screen</span>
                          </button>
                        )}
                        {payloadObj && Object.keys(payloadObj).length > 0 && (
                          <button
                            onClick={() => setSelectedPayload(payloadObj)}
                            className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-[11px] font-semibold cursor-pointer"
                          >
                            <Terminal className="w-3 h-3 text-emerald-400" />
                            <span>Data</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    No events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div
          onClick={() => setSelectedScreenshot(null)}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 cursor-pointer"
        >
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-4xl max-h-[85vh] p-4 flex flex-col space-y-3 shadow-2xl">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Checkpoint Screenshot</span>
              <span>Click anywhere to dismiss</span>
            </div>
            <img
              src={selectedScreenshot}
              alt="Screenshot Preview"
              className="max-h-[70vh] object-contain rounded-lg border border-gray-800"
            />
          </div>
        </div>
      )}

      {/* JSON Payload Modal */}
      {selectedPayload && (
        <div
          onClick={() => setSelectedPayload(null)}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">Event Payload Detail</h4>
              <button
                onClick={() => setSelectedPayload(null)}
                className="text-xs text-gray-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <pre className="bg-black/60 p-4 rounded-xl text-xs font-mono text-emerald-400 overflow-auto max-h-96 border border-gray-800">
              {JSON.stringify(selectedPayload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
