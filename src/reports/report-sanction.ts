/** Sanctions possibles quand un signalement est résolu (fondé). */
export enum ReportSanction {
  WARNING = 'WARNING',
  CONTENT_REMOVED = 'CONTENT_REMOVED',
  RESTRICTED = 'RESTRICTED',
  BANNED = 'BANNED',
}

export const REPORT_SANCTION_LABELS: Record<ReportSanction, string> = {
  [ReportSanction.WARNING]: 'Avertissement',
  [ReportSanction.CONTENT_REMOVED]: 'Contenu retiré / masqué',
  [ReportSanction.RESTRICTED]: 'Accès limité',
  [ReportSanction.BANNED]: 'Compte suspendu',
};

export const REPORT_SANCTION_TARGET_BODY: Record<ReportSanction, string> = {
  [ReportSanction.WARNING]:
    'Un signalement te concernant a été retenu par l’équipe Himba. Tu reçois un avertissement : respecte les règles de la communauté pour éviter une sanction plus lourde.',
  [ReportSanction.CONTENT_REMOVED]:
    'Un signalement te concernant a été retenu. Le contenu signalé a fait l’objet d’une action de modération (retrait ou masquage).',
  [ReportSanction.RESTRICTED]:
    'Un signalement te concernant a été retenu. Ton accès à Himba a été limité. Contacte le support si tu penses qu’il s’agit d’une erreur.',
  [ReportSanction.BANNED]:
    'Un signalement te concernant a été retenu. Ton compte a été suspendu. Tu ne peux plus te connecter tant que la suspension n’est pas levée.',
};
