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
  // Wizard: show one question at a time
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [focusedOption, setFocusedOption] = useState(0);
  const optionRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const customInputRef = useRef<HTMLInputElement>(null);

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  // Check if current question is answered
  const isCurrentAnswered = () => {
    const selected = answers[currentQuestion.question] || [];
    const custom = customInputs[currentQuestion.question];
    return selected.length > 0 || !!custom;
  };

  const handleOptionSelect = (optionLabel: string) => {
    const q = currentQuestion;
    setAnswers((prev) => {
      const current = prev[q.question] || [];
      if (q.multiSelect) {
        // Toggle for multi-select
        if (current.includes(optionLabel)) {
          return { ...prev, [q.question]: current.filter((o) => o !== optionLabel) };
        }
        return { ...prev, [q.question]: [...current, optionLabel] };
      } else {
        // Single select - set and auto-advance
        return { ...prev, [q.question]: [optionLabel] };
      }
    });
    // Clear custom input when selecting an option
    setCustomInputs((prev) => ({ ...prev, [q.question]: '' }));

    // Auto-advance for single-choice questions
    if (!q.multiSelect) {
      setTimeout(() => {
        if (isLastQuestion) {
          // Auto-submit on last question
          handleSubmitWithAnswer(optionLabel);
        } else {
          setCurrentQuestionIndex((prev) => prev + 1);
          setFocusedOption(0);
        }
      }, 150);
    }
  };

  // Submit with the just-selected answer (for auto-submit on last question)
  const handleSubmitWithAnswer = (lastAnswer: string) => {
    const formattedAnswers: Record<string, string> = {};
    for (const q of questions) {
      if (q.question === currentQuestion.question) {
        formattedAnswers[q.question] = lastAnswer;
      } else {
        const selected = answers[q.question] || [];
        const custom = customInputs[q.question];
        if (custom) {
          formattedAnswers[q.question] = custom;
        } else if (selected.length > 0) {
          formattedAnswers[q.question] = selected.join(', ');
        }
      }
    }
    onAnswer(formattedAnswers);
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

  const handleNext = () => {
    if (!isLastQuestion && isCurrentAnswered()) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setFocusedOption(0);
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
      setFocusedOption(0);
    }
  };

  // Handle custom input submit with Enter
  const handleCustomInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && customInputs[currentQuestion.question]) {
      e.preventDefault();
      if (isLastQuestion) {
        handleSubmit();
      } else {
        handleNext();
      }
    }
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent, optIdx: number) => {
      const optionCount = currentQuestion.options.length;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedOption((prev) => Math.min(prev + 1, optionCount - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedOption((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          handleOptionSelect(currentQuestion.options[optIdx].label);
          break;
        case 'ArrowRight':
          if (!currentQuestion.multiSelect && isCurrentAnswered() && !isLastQuestion) {
            e.preventDefault();
            handleNext();
          }
          break;
        case 'ArrowLeft':
          if (currentQuestionIndex > 0) {
            e.preventDefault();
            handleBack();
          }
          break;
      }
    },
    [currentQuestion, isLastQuestion, currentQuestionIndex]
  );

  // Focus management
  useEffect(() => {
    const button = optionRefs.current.get(focusedOption);
    button?.focus();
  }, [focusedOption, currentQuestionIndex]);

  const selectedOptions = answers[currentQuestion.question] || [];

  return (
    <div className="flex justify-start animate-fade-in my-3">
      <div className="max-w-[500px] w-full">
        <div className="bg-amber-50/80 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden shadow-sm">
          {/* Header with progress */}
          <div className="px-4 py-3 border-b border-amber-200/50 dark:border-amber-700/50 bg-amber-100/50 dark:bg-amber-800/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                  Agent needs your input
                </span>
              </div>
              {questions.length > 1 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {currentQuestionIndex + 1} / {questions.length}
                </span>
              )}
            </div>
            {/* Progress bar */}
            {questions.length > 1 && (
              <div className="mt-2 h-1 bg-amber-200 dark:bg-amber-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Current Question */}
          <div className="p-4">
            {currentQuestion.header && (
              <span className="inline-block px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs rounded-full font-medium mb-2">
                {currentQuestion.header}
              </span>
            )}
            <p className="font-medium text-foreground mb-4">{currentQuestion.question}</p>

            {/* Options */}
            <div className="space-y-2">
              {currentQuestion.options.map((opt, optIdx) => {
                const isSelected = selectedOptions.includes(opt.label);
                return (
                  <button
                    key={optIdx}
                    ref={(el) => {
                      if (el) optionRefs.current.set(optIdx, el);
                      else optionRefs.current.delete(optIdx);
                    }}
                    onClick={() => handleOptionSelect(opt.label)}
                    onKeyDown={(e) => handleKeyDown(e, optIdx)}
                    tabIndex={focusedOption === optIdx ? 0 : -1}
                    className={`w-full text-left p-3 rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${
                      isSelected
                        ? 'border-amber-500 bg-amber-100/50 dark:bg-amber-800/30 scale-[1.02]'
                        : 'border-amber-200 dark:border-amber-700/50 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-800/20'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
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
              <div className="pt-2">
                <input
                  ref={customInputRef}
                  type="text"
                  placeholder="Or type a custom answer..."
                  value={customInputs[currentQuestion.question] || ''}
                  onChange={(e) => {
                    setCustomInputs((prev) => ({ ...prev, [currentQuestion.question]: e.target.value }));
                    if (e.target.value) {
                      setAnswers((prev) => ({ ...prev, [currentQuestion.question]: [] }));
                    }
                  }}
                  onKeyDown={handleCustomInputKeyDown}
                  className="w-full px-3 py-2 text-sm border border-amber-200 dark:border-amber-700/50 rounded-lg bg-white/50 dark:bg-background/50 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
              </div>
            </div>
          </div>

          {/* Footer with navigation */}
          <div className="px-4 py-3 border-t border-amber-200/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-800/10 flex items-center justify-between">
            <div className="flex gap-2">
              {currentQuestionIndex > 0 && (
                <button
                  onClick={handleBack}
                  className="px-3 py-1.5 text-sm rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
              )}
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-sm rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors"
              >
                Skip
              </button>
            </div>
            <div>
              {currentQuestion.multiSelect && !isLastQuestion && (
                <button
                  onClick={handleNext}
                  disabled={!isCurrentAnswered()}
                  className="px-4 py-1.5 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  Next
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {(isLastQuestion || currentQuestion.multiSelect) && isCurrentAnswered() && isLastQuestion && (
                <button
                  onClick={handleSubmit}
                  className="px-4 py-1.5 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
