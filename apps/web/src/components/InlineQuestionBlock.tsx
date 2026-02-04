import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { type AgentQuestion } from '../store/threadStore';

interface InlineQuestionBlockProps {
  questions: AgentQuestion[];
  onAnswer: (answers: Record<string, string>) => void;
  onCancel: () => void;
}

export function InlineQuestionBlock({ questions, onAnswer, onCancel }: InlineQuestionBlockProps) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  // Keyboard navigation state
  const [focusedQuestion, setFocusedQuestion] = useState(0);
  const [focusedOption, setFocusedOption] = useState<Record<number, number>>({});
  const optionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleOptionToggle = (questionText: string, optionLabel: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionText] || [];
      if (multiSelect) {
        if (current.includes(optionLabel)) {
          return { ...prev, [questionText]: current.filter((o) => o !== optionLabel) };
        }
        return { ...prev, [questionText]: [...current, optionLabel] };
      } else {
        return { ...prev, [questionText]: [optionLabel] };
      }
    });
  };

  // Keyboard navigation handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent, qIdx: number, optIdx: number, multiSelect: boolean) => {
      const q = questions[qIdx];
      const optionCount = q.options.length;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (optIdx < optionCount - 1) {
            setFocusedOption((prev) => ({ ...prev, [qIdx]: optIdx + 1 }));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (optIdx > 0) {
            setFocusedOption((prev) => ({ ...prev, [qIdx]: optIdx - 1 }));
          }
          break;
        case 'Tab':
          if (!e.shiftKey && qIdx < questions.length - 1) {
            e.preventDefault();
            setFocusedQuestion(qIdx + 1);
            setFocusedOption((prev) => ({ ...prev, [qIdx + 1]: prev[qIdx + 1] ?? 0 }));
          } else if (e.shiftKey && qIdx > 0) {
            e.preventDefault();
            setFocusedQuestion(qIdx - 1);
            setFocusedOption((prev) => ({ ...prev, [qIdx - 1]: prev[qIdx - 1] ?? 0 }));
          }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          handleOptionToggle(q.question, q.options[optIdx].label, multiSelect);
          // Auto-advance for single-choice questions
          if (!multiSelect && qIdx < questions.length - 1) {
            setTimeout(() => {
              setFocusedQuestion(qIdx + 1);
              setFocusedOption((prev) => ({ ...prev, [qIdx + 1]: prev[qIdx + 1] ?? 0 }));
            }, 150);
          }
          break;
      }
    },
    [questions, handleOptionToggle]
  );

  // Manage focus when focused question/option changes
  useEffect(() => {
    const optIdx = focusedOption[focusedQuestion] ?? 0;
    const refKey = `${focusedQuestion}-${optIdx}`;
    const button = optionRefs.current.get(refKey);
    button?.focus();
  }, [focusedQuestion, focusedOption]);

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
    <div className="flex justify-start animate-fade-in my-3">
      <div className="max-w-[60%] w-full">
        <div className="bg-amber-50/80 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden shadow-sm">
          {/* Header */}
          <div className="px-4 py-3 border-b border-amber-200/50 dark:border-amber-700/50 bg-amber-100/50 dark:bg-amber-800/20">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                Agent needs your input
              </span>
            </div>
          </div>

          {/* Questions */}
          <div className="p-4 space-y-5">
            {questions.map((q, idx) => (
              <div key={idx} className="space-y-3">
                {q.header && (
                  <span className="inline-block px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs rounded-full font-medium">
                    {q.header}
                  </span>
                )}
                <p className="font-medium text-foreground">{q.question}</p>

                {/* Options */}
                <div className="space-y-2">
                  {q.options.map((opt, optIdx) => {
                    const isSelected = (answers[q.question] || []).includes(opt.label);
                    const isFocusTarget =
                      focusedQuestion === idx && (focusedOption[idx] ?? 0) === optIdx;
                    return (
                      <button
                        key={optIdx}
                        ref={(el) => {
                          const refKey = `${idx}-${optIdx}`;
                          if (el) {
                            optionRefs.current.set(refKey, el);
                          } else {
                            optionRefs.current.delete(refKey);
                          }
                        }}
                        onClick={() => handleOptionToggle(q.question, opt.label, q.multiSelect)}
                        onKeyDown={(e) => handleKeyDown(e, idx, optIdx, q.multiSelect)}
                        tabIndex={isFocusTarget ? 0 : -1}
                        className={`w-full text-left p-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-100/50 dark:bg-amber-800/30'
                            : 'border-amber-200 dark:border-amber-700/50 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-800/20'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              isSelected ? 'border-amber-500 bg-amber-500' : 'border-amber-400'
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
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{opt.label}</p>
                            {opt.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Custom input */}
                  <div className="pt-1">
                    <input
                      type="text"
                      placeholder="Or type a custom answer..."
                      value={customInputs[q.question] || ''}
                      onChange={(e) => {
                        setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }));
                        if (e.target.value) {
                          setAnswers((prev) => ({ ...prev, [q.question]: [] }));
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-amber-200 dark:border-amber-700/50 rounded-lg bg-white/50 dark:bg-background/50 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-amber-200/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-800/10 flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className="px-4 py-1.5 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
