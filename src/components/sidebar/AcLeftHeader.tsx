import { Plus, CaretDoubleLeft } from "@phosphor-icons/react";

/**
 * Nagłówek lewego panelu — wspólny dla wszystkich zakładek.
 *
 * Makieta (`panelTitle` / `panelCount`) zmienia tylko tytuł i licznik:
 *   Jednostki   → „Struktura sił"      + liczba jednostek
 *   Symulacja   → „Symulacja"          + „×8" (tempo)
 *   Starcia     → „Aktywne starcia"    + liczba starć
 *   Porównaj    → „Potencjał bojowy"   + liczba porównywanych
 *   Monitoring  → „Dziennik zdarzeń"   + liczba zdarzeń
 */
type Props = {
  title: string;
  count: string | number;
  onAdd?: () => void;
  onCollapse?: () => void;
  /** Treść dodatkowa pod tytułem (wyszukiwarka i filtry — tylko „Jednostki"). */
  children?: React.ReactNode;
};

export default function AcLeftHeader({ title, count, onAdd, onCollapse, children }: Props) {
  return (
    <div className="ac-left-head">
      <div className="ac-left-titlerow">
        <span className="ac-left-title">{title}</span>
        <span className="ac-left-count">{count}</span>
        <div className="ac-left-spacer" />
        {onAdd && (
          <button className="ac-iconbtn accent" title="Nowa jednostka" onClick={onAdd}>
            <Plus size={15} />
          </button>
        )}
        <button className="ac-iconbtn" title="Zwiń panel" onClick={onCollapse}>
          <CaretDoubleLeft size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}
