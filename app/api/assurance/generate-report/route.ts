import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SUB_TOOL_NAMES } from '@/lib/assurance-ai';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { engagementId, reportType } = await request.json();

    if (!engagementId || !reportType) {
      return NextResponse.json({ error: 'engagementId and reportType are required' }, { status: 400 });
    }

    const engagement = await prisma.assuranceEngagement.findFirst({
      where: { id: engagementId, firmId: session.user.firmId },
      include: { client: true },
    });

    if (!engagement) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    const subToolName = SUB_TOOL_NAMES[engagement.subTool] || engagement.subTool;
    const clientName = engagement.client.clientName;
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_WIDTH = 595.28; // A4
    const PAGE_HEIGHT = 841.89;
    const MARGIN = 50;
    const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

    // Helper: add text with word wrap
    function addWrappedText(
      page: ReturnType<typeof pdfDoc.addPage>,
      text: string,
      x: number,
      startY: number,
      maxWidth: number,
      fontSize: number,
      currentFont: typeof font,
      colour = rgb(0.2, 0.2, 0.2),
    ): number {
      const words = text.split(' ');
      let line = '';
      let y = startY;
      const lineHeight = fontSize * 1.4;

      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const testWidth = currentFont.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && line) {
          page.drawText(line, { x, y, size: fontSize, font: currentFont, color: colour });
          y -= lineHeight;
          line = word;

          if (y < MARGIN) {
            const newPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            page = newPage;
            y = PAGE_HEIGHT - MARGIN;
          }
        } else {
          line = testLine;
        }
      }
      if (line) {
        page.drawText(line, { x, y, size: fontSize, font: currentFont, color: colour });
        y -= lineHeight;
      }
      return y;
    }

    if (reportType === 'terms_of_reference') {
      // ─── ToR PDF ──────────────────────────────────────────────────────
      if (!engagement.termsOfReference) {
        return NextResponse.json({ error: 'ToR not yet generated' }, { status: 400 });
      }

      const tor = JSON.parse(engagement.termsOfReference);

      // Cover page
      let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(0.12, 0.25, 0.47) });

      page.drawText('ACUMON INTELLIGENCE', { x: MARGIN, y: PAGE_HEIGHT - 100, size: 14, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText('Terms of Reference', { x: MARGIN, y: PAGE_HEIGHT - 160, size: 28, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText(subToolName, { x: MARGIN, y: PAGE_HEIGHT - 200, size: 16, font, color: rgb(0.7, 0.8, 1) });
      page.drawText(`Prepared for: ${clientName}`, { x: MARGIN, y: PAGE_HEIGHT - 240, size: 12, font, color: rgb(0.7, 0.8, 1) });
      page.drawText(dateStr, { x: MARGIN, y: PAGE_HEIGHT - 270, size: 10, font, color: rgb(0.6, 0.7, 0.9) });
      if (engagement.sector) {
        page.drawText(`Sector: ${engagement.sector}`, { x: MARGIN, y: PAGE_HEIGHT - 295, size: 10, font, color: rgb(0.6, 0.7, 0.9) });
      }

      // Contents page
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let y = PAGE_HEIGHT - MARGIN;
      page.drawText('Contents', { x: MARGIN, y, size: 18, font: fontBold, color: rgb(0.12, 0.25, 0.47) });
      y -= 30;

      const sections = tor.sections || [];
      for (let i = 0; i < sections.length; i++) {
        page.drawText(`${i + 1}. ${sections[i].title}`, { x: MARGIN, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 18;
      }

      // Section pages
      for (let i = 0; i < sections.length; i++) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        page.drawText(`${i + 1}. ${sections[i].title}`, { x: MARGIN, y, size: 14, font: fontBold, color: rgb(0.12, 0.25, 0.47) });
        y -= 25;
        y = addWrappedText(page, sections[i].content, MARGIN, y, CONTENT_WIDTH, 10, font);
      }

    } else if (reportType === 'board_report') {
      // ─── Board Report PDF ─────────────────────────────────────────────
      if (!engagement.reportContent) {
        return NextResponse.json({ error: 'Report not yet generated' }, { status: 400 });
      }

      const report = JSON.parse(engagement.reportContent);

      // Cover page
      let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(0.08, 0.15, 0.35) });

      page.drawText('ACUMON INTELLIGENCE', { x: MARGIN, y: PAGE_HEIGHT - 100, size: 14, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText('Assurance Report', { x: MARGIN, y: PAGE_HEIGHT - 160, size: 28, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText(subToolName, { x: MARGIN, y: PAGE_HEIGHT - 200, size: 16, font, color: rgb(0.7, 0.8, 1) });
      page.drawText(`Prepared for: ${clientName}`, { x: MARGIN, y: PAGE_HEIGHT - 240, size: 12, font, color: rgb(0.7, 0.8, 1) });
      page.drawText(dateStr, { x: MARGIN, y: PAGE_HEIGHT - 270, size: 10, font, color: rgb(0.6, 0.7, 0.9) });
      page.drawText(`Overall Score: ${engagement.score}/100`, { x: MARGIN, y: PAGE_HEIGHT - 300, size: 14, font: fontBold, color: rgb(1, 0.85, 0.2) });

      // Contents
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let y = PAGE_HEIGHT - MARGIN;
      page.drawText('Contents', { x: MARGIN, y, size: 18, font: fontBold, color: rgb(0.08, 0.15, 0.35) });
      y -= 30;
      const tocItems = ['Executive Summary', 'Recommendations', 'Findings', 'Next Steps', 'Appendix A: Documents Reviewed', 'Appendix B: Caveats and Conditions'];
      for (let i = 0; i < tocItems.length; i++) {
        page.drawText(`${i + 1}. ${tocItems[i]}`, { x: MARGIN, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 18;
      }

      // Executive Summary
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      page.drawText('1. Executive Summary', { x: MARGIN, y, size: 14, font: fontBold, color: rgb(0.08, 0.15, 0.35) });
      y -= 25;
      y = addWrappedText(page, report.executiveSummary || '', MARGIN, y, CONTENT_WIDTH, 10, font);

      // Recommendations
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      page.drawText('2. Recommendations', { x: MARGIN, y, size: 14, font: fontBold, color: rgb(0.08, 0.15, 0.35) });
      y -= 25;
      for (const rec of (report.recommendations || [])) {
        const priorityLabel = `[${String(rec.priority).toUpperCase()}] `;
        page.drawText(priorityLabel, { x: MARGIN, y, size: 9, font: fontBold, color: rec.priority === 'high' ? rgb(0.8, 0.1, 0.1) : rec.priority === 'medium' ? rgb(0.7, 0.5, 0) : rgb(0.2, 0.4, 0.7) });
        const prefixWidth = fontBold.widthOfTextAtSize(priorityLabel, 9);
        y = addWrappedText(page, rec.recommendation, MARGIN + prefixWidth, y, CONTENT_WIDTH - prefixWidth, 9, font);
        y -= 8;
        if (y < MARGIN) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN; }
      }

      // Findings
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      page.drawText('3. Findings', { x: MARGIN, y, size: 14, font: fontBold, color: rgb(0.08, 0.15, 0.35) });
      y -= 25;
      for (const finding of (report.findings || [])) {
        page.drawText(`[${String(finding.severity).toUpperCase()}] ${finding.area}`, { x: MARGIN, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
        y -= 14;
        y = addWrappedText(page, finding.detail, MARGIN + 10, y, CONTENT_WIDTH - 10, 9, font);
        y -= 10;
        if (y < MARGIN) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN; }
      }

      // Next Steps
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      page.drawText('4. Next Steps', { x: MARGIN, y, size: 14, font: fontBold, color: rgb(0.08, 0.15, 0.35) });
      y -= 25;
      for (const step of (report.nextSteps || [])) {
        page.drawText('→', { x: MARGIN, y, size: 10, font, color: rgb(0.2, 0.4, 0.7) });
        y = addWrappedText(page, step, MARGIN + 15, y, CONTENT_WIDTH - 15, 9, font);
        y -= 8;
        if (y < MARGIN) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN; }
      }

      // Caveats page
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      page.drawText('Appendix B: Caveats and Conditions', { x: MARGIN, y, size: 14, font: fontBold, color: rgb(0.08, 0.15, 0.35) });
      y -= 25;
      const caveats = [
        'This report has been prepared by Acumon Intelligence using AI-assisted analysis. While every effort has been made to ensure accuracy, the findings are based solely on the documents provided and the information available at the time of review.',
        'This report does not constitute legal, financial, or regulatory advice. Organisations should seek independent professional advice before making decisions based on these findings.',
        'The scoring methodology provides a relative assessment based on the evidence reviewed and should be considered alongside other assurance activities and professional judgement.',
        'Acumon Intelligence is available to provide further assurance, advisory, and continuous improvement services.',
      ];
      for (const caveat of caveats) {
        y = addWrappedText(page, caveat, MARGIN, y, CONTENT_WIDTH, 8, font, rgb(0.4, 0.4, 0.4));
        y -= 10;
      }
    } else {
      return NextResponse.json({ error: 'Invalid reportType' }, { status: 400 });
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reportType}_${clientName}.pdf"`,
      },
    });
  } catch (err) {
    console.error('[Assurance:GenerateReport] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
