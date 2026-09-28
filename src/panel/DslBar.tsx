import type { DslError } from '../core/dsl';

export function DslBar(props: { text: string; error: DslError | null; status: string; onText(t: string): void; onApply(): void }) {
  const { text, error, status } = props;
  return (
    <div className="dqp-dsl">
      <textarea
        aria-label="Query"
        className={error ? 'dqp-bad' : ''}
        rows={2}
        spellCheck={false}
        value={text}
        onChange={(e) => props.onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            props.onApply();
          }
        }}
      />
      {error ? (
        <pre className="dqp-msg dqp-bad">{`${text}\n${' '.repeat(error.col)}^ ${error.message}`}</pre>
      ) : (
        <p className="dqp-msg">{status || 'Edit filters on the left, or type here and press Enter.'}</p>
      )}
    </div>
  );
}
