import { useState } from 'react';
import { type AgentQuestion } from '../store/threadStore';

interface QuestionModalProps {
  questions: AgentQuestion[];
  onAnswer: (answers: Record<string, string>) => void;
  onCancel: () => void;
}

export function QuestionModal({ questions, onAnswer, onCancel }: QuestionModalProps) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  const handleOptionToggle = (questionText: string, optionLabel: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionText] || [];
      if (multiSelect) {
        // Toggle selection
        if (current.includes(optionLabel)) {
          return { ...prev, [questionText]: current.filter((o) => o !== optionLabel) };
        }
        return { ...prev, [questionText]: [...current, optionLabel] };
      } else {
        // Single select
        return { ...prev, [questionText]: [optionLabel] };
      }
    });
  };

  const handleSubmit = () => {
    const formattedAnswers: Record<string, string> = {};
    for (const q of questions) {
      const selected = answers[q.question] || [];
      const custom = customInputs[q.question];
      if (custom) {
        formattedAnswers[q.question] = custom;
      } else if (selected.length > 0) {
        formattedAnswers[q.question] = selected.join(', ');
      }
    }
    onAnswer(formattedAnswers);
  };

  const allAnswered = questions.every((q) => {
    const selected = answers[q.question] || [];
    const custom = customInputs[q.question];
    return selected.length > 0 || !!custom;
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="font-semibold">Agent Question</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            The agent needs your input to continue
          </p>
        </div>

        {/* Questions */}
        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {questions.map((q, idx) => (
            <div key={idx} className="space-y-3">
              {q.header && (
                <span className="inline-block px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full font-medium">
                  {q.header}
                </span>
              )}
              <p className="font-medium">{q.question}</p>

              {/* Options */}
              <div className="space-y-2">
                {q.options.map((opt, optIdx) => {
                  const isSelected = (answers[q.question] || []).includes(opt.label);
                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleOptionToggle(q.question, opt.label, q.multiSelect)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{opt.label}</p>
                          {opt.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Custom input option */}
                <div className="pt-2">
                  <input
                    type="text"
                    placeholder="Or type a custom answer..."
                    value={customInputs[q.question] || ''}
                    onChange={(e) => {
                      setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }));
                      // Clear selections when typing custom
                      if (e.target.value) {
                        setAnswers((prev) => ({ ...prev, [q.question]: [] }));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/30 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
