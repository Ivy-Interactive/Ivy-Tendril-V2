import { DEFAULT_LOCALE, type SiteLocale } from "./locales.config";

export interface UiTranslations {
  onThisPage: string;
  previous: string;
  next: string;
  search: string;
  searchPlaceholder: string;
  chooseLanguage: string;
  pageNotFound: string;
  pageNotFoundDescription: string;
  pageNotFoundUseSidebar: string;
  pageNotFoundToSearch: string;
  startFromIntroduction: string;
  untranslatedTitle: string;
  untranslatedDescription: string;
}

export const TRANSLATIONS: Record<SiteLocale, UiTranslations> = {
  en: {
    onThisPage: "On this page",
    previous: "Previous",
    next: "Next",
    search: "Search",
    searchPlaceholder: "Search the documentation…",
    chooseLanguage: "Choose language",
    pageNotFound: "Page not found",
    pageNotFoundDescription: "Nothing is published at",
    pageNotFoundUseSidebar: "Use the sidebar, press",
    pageNotFoundToSearch: "to search, or",
    startFromIntroduction: "start from the introduction",
    untranslatedTitle: "This page is not yet translated",
    untranslatedDescription:
      "You are viewing the English version of this article. A translated version is not yet available for your selected language.",
  },
  de: {
    onThisPage: "Auf dieser Seite",
    previous: "Zurück",
    next: "Weiter",
    search: "Suchen",
    searchPlaceholder: "Dokumentation durchsuchen...",
    chooseLanguage: "Sprache wählen",
    pageNotFound: "Seite nicht gefunden",
    pageNotFoundDescription: "Nichts veröffentlicht unter",
    pageNotFoundUseSidebar: "Nutzen Sie die Seitenleiste, drücken Sie",
    pageNotFoundToSearch: "zum Suchen, oder",
    startFromIntroduction: "beginnen Sie mit der Einführung",
    untranslatedTitle: "Diese Seite ist noch nicht übersetzt",
    untranslatedDescription:
      "Sie sehen die englische Version dieses Artikels. Für die ausgewählte Sprache ist noch keine Übersetzung verfügbar.",
  },
  ja: {
    onThisPage: "目次",
    previous: "前へ",
    next: "次へ",
    search: "検索",
    searchPlaceholder: "ドキュメントを検索...",
    chooseLanguage: "言語を選択",
    pageNotFound: "ページが見つかりません",
    pageNotFoundDescription: "ここには何も公開されていません:",
    pageNotFoundUseSidebar: "サイドバーを使用するか、",
    pageNotFoundToSearch: "キーを押して検索するか、",
    startFromIntroduction: "導入から始める",
    untranslatedTitle: "このページはまだ翻訳されていません",
    untranslatedDescription:
      "この記事の英語版を表示しています。選択した言語の翻訳版はまだ利用できません。",
  },
  es: {
    onThisPage: "En esta página",
    previous: "Anterior",
    next: "Siguiente",
    search: "Buscar",
    searchPlaceholder: "Buscar en la documentación...",
    chooseLanguage: "Elegir idioma",
    pageNotFound: "Página no encontrada",
    pageNotFoundDescription: "No hay nada publicado en",
    pageNotFoundUseSidebar: "Usa la barra lateral, presiona",
    pageNotFoundToSearch: "para buscar, o",
    startFromIntroduction: "comenzar desde la introducción",
    untranslatedTitle: "Esta página aún no está traducida",
    untranslatedDescription:
      "Estás viendo la versión en inglés de este artículo. Aún no hay una versión traducida disponible para el idioma seleccionado.",
  },
  fr: {
    onThisPage: "Sur cette page",
    previous: "Précédent",
    next: "Suivant",
    search: "Rechercher",
    searchPlaceholder: "Rechercher dans la doc...",
    chooseLanguage: "Choisir la langue",
    pageNotFound: "Page non trouvée",
    pageNotFoundDescription: "Rien n'est publié à",
    pageNotFoundUseSidebar: "Utilisez la barre latérale, appuyez sur",
    pageNotFoundToSearch: "pour rechercher, ou",
    startFromIntroduction: "commencer par l'introduction",
    untranslatedTitle: "Cette page n'est pas encore traduite",
    untranslatedDescription:
      "Vous consultez la version anglaise de cet article. Aucune traduction n'est encore disponible pour la langue sélectionnée.",
  },
  pt: {
    onThisPage: "Nesta página",
    previous: "Anterior",
    next: "Próximo",
    search: "Buscar",
    searchPlaceholder: "Buscar documentação...",
    chooseLanguage: "Escolher idioma",
    pageNotFound: "Página não encontrada",
    pageNotFoundDescription: "Nada publicado em",
    pageNotFoundUseSidebar: "Use a barra lateral, pressione",
    pageNotFoundToSearch: "para pesquisar, ou",
    startFromIntroduction: "comece pela introdução",
    untranslatedTitle: "Esta página ainda não foi traduzida",
    untranslatedDescription:
      "Você está visualizando a versão em inglês deste artigo. Uma versão traduzida ainda não está disponível para o idioma selecionado.",
  },
  zh: {
    onThisPage: "本页导读",
    previous: "上一页",
    next: "下一页",
    search: "搜索",
    searchPlaceholder: "搜索文档...",
    chooseLanguage: "选择语言",
    pageNotFound: "页面未找到",
    pageNotFoundDescription: "未在此路径发布任何内容：",
    pageNotFoundUseSidebar: "使用侧边栏，按",
    pageNotFoundToSearch: "搜索，或",
    startFromIntroduction: "从介绍开始",
    untranslatedTitle: "此页面尚未翻译",
    untranslatedDescription: "您正在查看本文的英文版本。所选语言的翻译版本尚不可用。",
  },
  ru: {
    onThisPage: "На этой странице",
    previous: "Назад",
    next: "Далее",
    search: "Поиск",
    searchPlaceholder: "Поиск по документации...",
    chooseLanguage: "Выбрать язык",
    pageNotFound: "Страница не найдена",
    pageNotFoundDescription: "Ничего не опубликовано по адресу",
    pageNotFoundUseSidebar: "Используйте боковую панель, нажмите",
    pageNotFoundToSearch: "для поиска, или",
    startFromIntroduction: "начните со введения",
    untranslatedTitle: "Эта страница еще не переведена",
    untranslatedDescription:
      "Вы просматриваете английскую версию этой статьи. Перевод для выбранного языка пока недоступен.",
  },
  sv: {
    onThisPage: "På den här sidan",
    previous: "Föregående",
    next: "Nästa",
    search: "Sök",
    searchPlaceholder: "Sök i dokumentationen...",
    chooseLanguage: "Välj språk",
    pageNotFound: "Sidan hittades inte",
    pageNotFoundDescription: "Inget är publicerat på",
    pageNotFoundUseSidebar: "Använd sidofältet, tryck på",
    pageNotFoundToSearch: "för att söka, eller",
    startFromIntroduction: "börja från introduktionen",
    untranslatedTitle: "Den här sidan är inte översatt ännu",
    untranslatedDescription:
      "Du visar den engelska versionen av den här artikeln. En översatt version är ännu inte tillgänglig för det valda språket.",
  },
  hi: {
    onThisPage: "इस पृष्ठ पर",
    previous: "पिछला",
    next: "अगला",
    search: "खोजें",
    searchPlaceholder: "दस्तावेज़ खोजें...",
    chooseLanguage: "भाषा चुनें",
    pageNotFound: "पृष्ठ नहीं मिला",
    pageNotFoundDescription: "यहाँ कुछ भी प्रकाशित नहीं है:",
    pageNotFoundUseSidebar: "साइडबार का उपयोग करें, दबाएँ",
    pageNotFoundToSearch: "खोजने के लिए, या",
    startFromIntroduction: "परिचय से शुरू करें",
    untranslatedTitle: "यह पृष्ठ अभी अनुवादित नहीं है",
    untranslatedDescription:
      "आप इस लेख का अंग्रेजी संस्करण देख रहे हैं। आपकी चुनी गई भाषा के लिए अनुवादित संस्करण अभी उपलब्ध नहीं है।",
  },
};

export function getTranslations(locale: string | undefined): UiTranslations {
  if (!locale) return TRANSLATIONS[DEFAULT_LOCALE];
  return TRANSLATIONS[locale as SiteLocale] ?? TRANSLATIONS[DEFAULT_LOCALE];
}
