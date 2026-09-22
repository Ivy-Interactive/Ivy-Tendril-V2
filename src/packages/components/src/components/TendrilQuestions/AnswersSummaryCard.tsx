import React from "react";
import { CheckCheck } from "lucide-react";
import type { ParsedAnswer } from "./answers";
import "./tendril-questions.css";

export interface AnswersSummaryCardProps {
  answers: ParsedAnswer[];
  className?: string;
}

/**
 * A submitted answers block, presented as the counterpart of the questions block the agent asked:
 * each question's label above the value it settled on, rather than the markdown summary that
 * travels to the agent.
 */
export const AnswersSummaryCard: React.FC<AnswersSummaryCardProps> = ({ answers, className }) => (
  <div
    className={`tq-root tq-answers-card${className ? ` ${className}` : ""}`}
    data-testid="answers-summary-card"
    role="group"
    aria-label="Submitted answers"
  >
    <div className="tq-answers-card-header">
      <CheckCheck className="tq-answers-card-icon" aria-hidden="true" />
      <span>Answers</span>
    </div>
    {answers.map((answer, index) => (
      <div className="tq-answers-card-row" key={`${answer.label}-${index}`}>
        <div className="tq-answers-card-label">{answer.label}</div>
        {answer.value ? (
          <div className="tq-answer">
            <span className="tq-answer-value">{answer.value}</span>
          </div>
        ) : (
          <div className="tq-answer tq-answer--none">
            {answer.skipped ? "Not answered (not required)" : "Not answered (agent decided)"}
          </div>
        )}
      </div>
    ))}
  </div>
);
