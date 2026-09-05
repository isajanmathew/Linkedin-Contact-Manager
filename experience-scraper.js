/**
 * LinkedInExperienceScraper (v2.4.0)
 *
 * Dedicated, strictly-bounded scraper for the CURRENT role of a LinkedIn
 * profile. It only ever looks inside the Experience section — never the top
 * card headline, never the activity/repost feed.
 *
 * Guarantees:
 *  - Search boundary locked to section:has(#experience) / [data-section="experience"]
 *  - Cards containing activity / recent-activity / "reposted this" are rejected
 *  - Grouped (multi-role) cards resolve company from the parent header and the
 *    title from the first nested role
 *  - "… more" / "...more" button artifacts, employment types, date ranges and
 *    glued month tokens are stripped
 *  - .text-body-medium (the headline) is never read
 */

(function () {
  const MONTHS =
    '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)';

  const EMPLOYMENT_TYPES = [
    'Full-time',
    'Part-time',
    'Self-employed',
    'Freelance',
    'Contract',
    'Internship',
    'Apprenticeship',
    'Seasonal',
    'Temporary',
];

  const REJECT_PATTERNS =
    /(reposted this|likes? this|commented on|recent activity|activity|followers?\b|celebrating|congratulat)/i;

  class LinkedInExperienceScraper {
    /** Public entry point: returns { jobTitle, company } (values may be null). */
    static extractMostRecent() {
      try {
        const scraper = new LinkedInExperienceScraper();
        return scraper.run();
      } catch (err) {
        console.warn('[experience-scraper] failed', err);
        return { jobTitle: null, company: null };
      }
    }

    run() {
      const section = this.getExperienceSection();
      if (!section) return { jobTitle: null, company: null };

      const card = this.getFirstValidCard(section);
      if (!card) return { jobTitle: null, company: null };

      const nested = this.getNestedRole(card);
      let jobTitle;
      let company;

      if (nested) {
        // Grouped card: company lives in the card header, title in the first role.
        company = this.textOf(this.headerTitleEl(card));
        jobTitle = this.textOf(this.headerTitleEl(nested));
      } else {
        jobTitle = this.textOf(this.headerTitleEl(card));
        company = this.companyFromCard(card);
      }

      return {
        jobTitle: this.sanitizeTitle(jobTitle),
        company: this.sanitizeCompany(company),
      };
    }

    /* ---------------------------------------------------------- boundaries */

    getExperienceSection() {
      const anchor = document.querySelector('#experience');
      if (anchor) {
        const section = anchor.closest('section');
        if (section) return section;
      }
      return (
        document.querySelector('section[data-section="experience"]') ||
        document.querySelector('#experience-section') ||
        null
      );
    }

    isRejected(el) {
      if (!el) return true;
      const cls = (el.className && String(el.className)) || '';
      if (/activity|recent-activity|feed-shared|social-details/i.test(cls)) return true;
      if (el.closest('[class*="recent-activity"], [class*="feed-shared"]')) return true;
      const text = (el.textContent || '').slice(0, 400);
      return REJECT_PATTERNS.test(text);
    }

    getFirstValidCard(section) {
      const lists = Array.from(
        section.querySelectorAll(':scope > div > ul, :scope > ul, ul.pvs-list'),
      );
      for (const list of lists) {
        const items = Array.from(list.children).filter((n) => n.tagName === 'LI');
        for (const li of items) {
          if (this.isRejected(li)) continue;
          if (this.headerTitleEl(li) || li.querySelector('ul')) return li;
        }
      }
      return null;
    }

    getNestedRole(card) {
      const list = card.querySelector('ul');
      if (!list) return null;
      const roles = Array.from(list.children).filter((n) => n.tagName === 'LI');
      for (const role of roles) {
        if (this.isRejected(role)) continue;
        if (this.headerTitleEl(role)) return role;
      }
      return null;
    }

    /* ------------------------------------------------------------- reading */

    /**
     * The bold primary line of a card/role. Explicitly avoids
     * .text-body-medium (the profile headline class).
     */
    headerTitleEl(scope) {
      const candidates = Array.from(
        scope.querySelectorAll(
          '.t-bold span[aria-hidden="true"], .hoverable-link-text span[aria-hidden="true"], .mr1.t-bold, div.t-bold',
        ),
      );
      for (const el of candidates) {
        if (el.closest('.text-body-medium')) continue;
        if (this.isRejected(el)) continue;
        const text = this.textOf(el);
        if (text && !this.isArtifact(text)) return el;
      }
      return null;
    }

    companyFromCard(card) {
      const link = card.querySelector('a[href*="/company/"]');
      if (link) {
        const alt = link.querySelector('img')?.getAttribute('alt');
        const fromAlt = this.textOf(alt);
        if (fromAlt && !/logo/i.test(fromAlt)) return fromAlt;
      }

      const lines = Array.from(
        card.querySelectorAll('span.t-14.t-normal span[aria-hidden="true"], span.t-14.t-normal'),
      )
        .map((el) => this.textOf(el))
        .filter((t) => t && !this.isArtifact(t) && !this.isDateLine(t));

      return lines[0] || null;
    }

    textOf(value) {
      const raw = typeof value === 'string' ? value : value?.textContent || '';
      return raw.replace(/\s+/g, ' ').trim() || null;
    }

    /* ------------------------------------------------------------ cleaning */

    isArtifact(text) {
      return /^(?:\.\.\.|…)?\s*(?:see )?more$/i.test(text) || /^…$/.test(text);
    }

    isDateLine(text) {
      return new RegExp(`^${MONTHS}\\s+\\d{4}|\\bPresent\\b|\\b\\d+\\s*(?:yrs?|mos?)\\b`, 'i').test(
        text,
      );
    }

    stripArtifacts(text) {
      if (!text) return null;
      let out = text
        .replace(/(?:\s*[·|-]\s*)?(?:\.\.\.|…)\s*(?:see\s*)?more\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      return out || null;
    }

    sanitizeTitle(text) {
      let out = this.stripArtifacts(text);
      if (!out) return null;
      out = out.replace(new RegExp(`\\s*·\\s*(?:${EMPLOYMENT_TYPES.join('|')})\\b`, 'gi'), '');
      out = out.replace(/\s*·\s*$/, '').trim();
      return out || null;
    }

    sanitizeCompany(text) {
      let out = this.stripArtifacts(text);
      if (!out) return null;

      // "Autodesk · Full-time" → "Autodesk"
      out = out.split(/\s*·\s*/)[0] || out;
      out = out.replace(new RegExp(`\\s*\\b(?:${EMPLOYMENT_TYPES.join('|')})\\b`, 'gi'), '');
      // date ranges and durations
      out = out.replace(
        new RegExp(`\\s*${MONTHS}\\.?\\s*\\d{4}.*$`, 'i'),
        '',
      );
      out = out.replace(/\s*\b\d+\s*(?:yrs?|mos?)\b.*$/i, '');
      out = out.replace(/\s*\bPresent\b.*$/i, '');
      // glued trailing month token: "Service DesignSep" → "Service Design"
      out = out.replace(new RegExp(`(?<=[a-z])${MONTHS}\\.?$`), '');
      out = out.replace(/[·,\s-]+$/, '').trim();
      return out || null;
    }
  }

  if (typeof window !== 'undefined') {
    window.LinkedInExperienceScraper = LinkedInExperienceScraper;
  }
})();
