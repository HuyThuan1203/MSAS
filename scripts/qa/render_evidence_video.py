#!/usr/bin/env python3
"""Create a 5-10 minute MSAS QA evidence video from ACTUAL reports/screenshots.

Optional tools: Pillow, ffmpeg, espeak (Vietnamese synthetic narration).
Runtime app has no dependency on these. No external footage/music/network.
Video is an evidence walkthrough; it is not a real-time 7min screen recording.
Screenshots and the short screen recording are actual Chromium QA artifacts.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, shutil, subprocess, sys, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT=Path(__file__).resolve().parents[2]
DEFAULT_REPORT=ROOT/'qa-artifacts/stress-report.json'
EVIDENCE=ROOT/'qa-artifacts/evidence'
WIDTH,HEIGHT=1280,720
BG=(9,18,29); PANEL=(21,40,56); WHITE=(231,242,247); GRAY=(146,174,191); TEAL=(104,218,185); GOLD=(255,195,104)
REG='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
if not Path(REG).exists():
    REG='/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf';BOLD='/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
F=lambda n,b=False: ImageFont.truetype(BOLD if b else REG,n)

def check_tool(name):
    exe=shutil.which(name)
    if not exe:raise RuntimeError(f'{name} required to render video; run QA without --video if unavailable')
    return exe

def call(args):
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

def duration(path):
    r=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nokey=1:noprint_wrappers=1',str(path)],text=True)
    return float(r.strip())

def wrapped(draw,text,font,maxwidth):
    words=text.split(' ');line='';out=[]
    for w in words:
        cand=(line+' '+w).strip()
        if draw.textbbox((0,0),cand,font=font)[2] > maxwidth and line:
            out.append(line);line=w
        else:line=cand
    if line:out.append(line)
    return out

def board(index,scene,report,out):
    im=Image.new('RGB',(WIDTH,HEIGHT),BG);d=ImageDraw.Draw(im)
    d.rectangle((0,0,WIDTH,7),fill=TEAL);d.text((50,30),'MSAS  /  TEST EVIDENCE',font=F(26,True),fill=TEAL)
    d.text((1160,36),f'{index+1:02d} / 11',font=F(20,True),fill=GRAY)
    d.text((50,96),scene['title'],font=F(34,True),fill=WHITE)
    d.text((52,153),scene['subtitle'],font=F(17),fill=GRAY)
    d.rounded_rectangle((42,206,559,620),radius=16,fill=PANEL)
    y=238
    for point in scene['points']:
        d.ellipse((66,y+10,77,y+21),fill=TEAL)
        lines=wrapped(d,point,F(20),442)
        for line in lines:
            d.text((92,y),line,font=F(20),fill=WHITE);y+=31
        y+=16
    screen=scene.get('image')
    if screen:
        p=EVIDENCE/screen
        if p.is_file():
            img=Image.open(p).convert('RGB')
            img=ImageOps.contain(img,(648,402),method=Image.Resampling.LANCZOS)
            x=594+(648-img.width)//2;yy=217+(402-img.height)//2
            d.rounded_rectangle((585,206,1248,621),radius=15,fill=(30,47,62))
            im.paste(img,(x,yy))
            d.rounded_rectangle((585,206,1248,621),radius=15,outline=(73,103,119),width=2)
    else:
        d.rounded_rectangle((585,206,1248,621),radius=15,fill=(20,42,54))
        count=report['coverage']['modes']
        for i,(name,n) in enumerate(list(count.items())[:12]):
            bx=614+(i%2)*312;by=229+(i//2)*58
            d.text((bx,by),name.upper(),font=F(16,True),fill=WHITE)
            d.rounded_rectangle((bx,by+28,bx+235,by+40),radius=5,fill=(56,82,99))
            d.rounded_rectangle((bx,by+28,bx+235*min(1,n/max(count.values())),by+40),radius=5,fill=TEAL)
    d.text((50,654),scene['source'],font=F(15),fill=GOLD)
    d.text((50,683),f"SEED {report['seed']}  |  SYNTHETIC OHLC  |  NO MARKET SIGNAL VALIDATION",font=F(14),fill=GRAY)
    im.save(out)


def scenes(report):
    c=len(report['cases']);bars=sum(i['bars'] for i in report['cases']);target=report['targeted']['cases'];gaps=report['policyGaps']['alreadyOutsideAfterRoleAssignment'];labels=report['coverage']['labels']
    return [
        dict(title='01  /  Test goal & sources',subtitle='Automated QA, traceable to the user PPT files',points=[
            f'{c} randomized OHLC sequences and {bars:,} closed candles',
            f'{target} targeted, independently labeled S+ / C / B trials',
            'All generated candles are clearly marked synthetic',
            'Real XAUUSD sample retained for independent pivot check'],image='05-final-xau.png',source='REV slides 2–8  ·  ADV slides 5–14'),
        dict(title='02  /  Major & Internal trend',subtitle='Current levels must evolve only when confirmed',points=[
            'Main: UP / DOWN / UNKNOWN, independent from Internal',
            'Major High / Low link to confirmed Swing pivots',
            'After strong reversal, the new pivot stays pending',
            'Confirmed roles cannot come from future candles'],image='04-major-update.png',source='ADV slides 5–11, 13–14'),
        dict(title='03  /  S+ — Strong MSS',subtitle='Only a strict closing-price breach confirms Main reversal',points=[
            f"{labels['S+']:,} synthetic S+ occurrences tested",
            'DOWN: Close above active Major High changes Main to UP',
            'UP: Close below active Major Low changes Main to DOWN',
            'Tolerance = 0; equality is not a breach'],image='02-strong-mss-splus.png',source='REV slides 3, 8  ·  tested in both directions'),
        dict(title='04  /  C — Weak MSS attempt',subtitle='Wick crosses a Major boundary, body closes inside',points=[
            f"{labels['C']:,} synthetic C occurrences checked",
            'A wick-only attempt must not reverse Main',
            'Exact wick and Close levels verified separately',
            'Open/body containment remains an explicit policy'],image='03-weak-mss-c.png',source='REV slides 4, 8  ·  confirm-vs-attempt distinction'),
        dict(title='05  /  CISD B — Early delivery shift',subtitle='Use the LAST old-direction candle cluster',points=[
            f"{labels['B']:,} synthetic B occurrences checked",
            'Compare Close to Open of the first candle in last group',
            'Works with a single candle and multiple groups',
            'B alone is NOT an MSS structural reversal'],image='01-cisd-b.png',source='REV slides 5–8  ·  mirrored up/down fixture'),
        dict(title='06  /  12 random market regimes',subtitle='Reproducible seed, deterministic OHLC, no invented candles',points=[
            'UP / DOWN / RANGE / VOLATILE',
            'WHIPSAW / INSIDE / SPIKE / GAPS',
            'PLATEAU / REVERSAL / SQUEEZE / MIXED',
            'Each case records its own seed and event counts'],image=None,source='Tests are synthetic metamorphic checks; not market ground truth'),
        dict(title='07  /  Causality & data integrity',subtitle='No-lookahead must hold on every tested prefix',points=[
            f"{report['assertions']:,} assertions executed in this run",
            'Events and role changes cannot appear early',
            'Original Swing 3-bar and Inside Bar logic preserved',
            'Additional randomized CSV importer and corruption tests'],image='00-pre-break.png',source='BASIC slides  ·  tests/test_random_import_contract.py'),
        dict(title='08  /  Human-reviewed XAU example',subtitle='Actual Chromium rendering and current pivot labels',points=[
            'XAUUSD M15, 18 June 2025, 48 candles',
            'Major High 3,396.648 at 14:30 UTC',
            'Major Low 3,373.545 at 15:15 UTC',
            'Final Main UP / Internal UP; EN/VI replay'],image='05-final-xau.png',source='User-confirmed pair  ·  no lookahead in role assignment'),
        dict(title='09  /  Offline HTML import & replay',subtitle='Real-browser actions: no HTTP requests, no JS exceptions',points=[
            'Single HTML file runs without Python or Docker',
            'Import random CSV and replay by closed candle',
            'Check EN/VI, concise notifications and levels',
            'Real Chromium screenshots + short screen recording'],image='07-random-csv-imported.png',source='Browser evidence JSON records the observed UI state'),
        dict(title='10  /  Covered Close edge and remaining REVIEW',subtitle='An automated PASS is NOT proof that every rule is defined',points=[
            f'{gaps:,} already-outside Close cases now exercised by strict S+ oracle',
            'No artificial second crossing required for confirmed MSS',
            'Major candidate ties and nested waves remain provisional',
            'User-reviewed XAU pivots and XAU40 rolling regression are guarded'],image='06-language-vi.png',source='Close rule tested; competing pivot tie-break remains provisional'),
        dict(title='11  /  Reproduce, CI and handoff',subtitle='One command, machine-readable evidence and video proof',points=[
            'Run: python scripts/qa_gate.py --stress --require-node',
            'GitHub Actions: Python, Node, Windows, browser, Docker',
            'Stress JSON + HTML report + CSV test ledger uploaded',
            'Manual CI run regenerates a 5–10 minute video'],image='08-playback.png',source='Logs, seed, code SHA, screenshots, media manifest'),
    ]


def narrations(report):
    c=len(report['cases']);n=sum(x['bars'] for x in report['cases']);g=report['policyGaps']['alreadyOutsideAfterRoleAssignment'];ass=report['assertions'];t=report['targeted']['cases']
    return [
        f'Đây là báo cáo kiểm thử tự động của hệ thống MSAS. Chúng tôi dùng các quy tắc gốc từ tài liệu hướng dẫn Swing và Inside Bar, tài liệu cấu trúc chính phụ, cùng tám trang về MSS và CISD. Đã thực hiện {c} chuỗi dữ liệu ngẫu nhiên, tổng cộng {n} nến đã đóng. Ngoài ra còn có {t} tình huống chủ đích được tạo với đáp án tự kiểm tra độc lập. Tất cả chuỗi ngẫu nhiên đều là dữ liệu tổng hợp. Chúng không được xem là nhãn đúng của thị trường thật.',
        'Đầu tiên là cấu trúc chính và cấu trúc phụ. Mọi trạng thái luôn được tính bằng những nến đã đóng và swing đã xác nhận. Cấu trúc chính có thể tăng, giảm hoặc chưa xác định. Cấu trúc phụ có thể đi ngược hướng chính mà không làm thay đổi xu hướng tổng thể. Major High và Major Low phải liên kết đến đúng swing hợp lệ. Khi đảo chiều được xác nhận, chỉ giữ mốc đối diện, còn mốc mới phải chờ swing xuất hiện và được xác nhận. Hệ thống không được sử dụng dữ liệu của các nến tương lai.',
        'Trong chương này, chúng tôi kiểm tra đảo chiều mạnh S cộng. Khi cấu trúc chính đang giảm, nến phải đóng cửa cao hơn Major High thì mới xác nhận đảo chiều tăng. Khi cấu trúc chính đang tăng, nến phải đóng cửa thấp hơn Major Low mới xác nhận đảo chiều giảm. Mức sai số được đặt bằng không. Giá đóng bằng đúng mức quan trọng không tính là phá. Chúng tôi tạo nhiều mẫu ở hai chiều, kiểm tra nhãn S cộng, thời điểm đổi xu hướng và trạng thái chờ mốc Major mới.',
        'Tiếp theo là nỗ lực đảo chiều yếu, ký hiệu C. Một ngọn râu nến có thể xuyên qua đỉnh hoặc đáy Major, nhưng phần thân lại đóng ở phía trong. Trường hợp này chỉ thể hiện nỗ lực vượt biên chưa thành công, không phải đảo chiều xu hướng chính. Bộ kiểm thử đọc trực tiếp giá cao nhất, thấp nhất, mở cửa và đóng cửa. Các trường hợp chạm đúng biên cũng được kiểm tra. Điều kiện giá mở cửa nằm bên trong là một quy ước triển khai, chưa được tài liệu quy định hoàn toàn cho mọi tình huống.',
        'Đối với tín hiệu B hay CISD, mục tiêu chỉ là nhận biết thay đổi hành vi của giá sớm hơn tín hiệu đảo chiều cấu trúc. Khi cấu trúc đang giảm, so giá đóng cửa nến tăng với giá mở cửa của nến đầu trong cụm giảm cuối cùng. Nếu có nhiều cụm giảm trong sóng hiện tại, phải chọn cụm cuối, không lấy cụm đầu. Quy tắc ngược lại áp dụng khi cấu trúc đang tăng. Nhiều bài kiểm tra ngẫu nhiên và ca cố định xác nhận rằng B không tự làm xu hướng chính đảo chiều.',
        'Dữ liệu ngẫu nhiên được chia đều vào mười hai chế độ giá để tránh chỉ kiểm tra một kiểu thị trường. Có xu hướng tăng, xu hướng giảm, đi ngang, biến động mạnh, nhiễu đảo liên tục, chuỗi inside bar, nến có râu dài, khoảng trống giữa nến, giá bằng nhau, đảo chiều xu hướng, thắt hẹp biên độ và trạng thái hỗn hợp. Mỗi ca dùng một seed cố định, tạo lại giống hệt trong lần chạy sau. Các file CSV đại diện cũng được lưu để người khác nhập trực tiếp vào giao diện.',
        f'Kiểm tra trọng yếu tiếp theo là tránh nhìn trước. Hệ thống được chạy với toàn bộ lịch sử và chạy lặp lại ở nhiều điểm cắt của chuỗi. Sự kiện nào chưa được biết tại nến hiện tại thì không được xuất hiện sớm. Thời điểm công nhận swing phải sau khi nến bên phải đã đóng. Chúng tôi cũng kiểm tra tính toàn vẹn OHLC, dấu thời gian trùng, cột viết hoa viết thường, dữ liệu thiếu Volume và các file có nội dung sai. Tổng cộng ghi nhận {ass} phép kiểm tra trong đợt stress này.',
        'Đây là ví dụ XAUUSD mà người dùng đã đánh dấu trực tiếp trên đồ thị. Bộ dữ liệu có bốn mươi tám nến M mười lăm. Tại nến cuối, cấu trúc chính tăng và cấu trúc phụ tăng. Major High nằm ở ba nghìn ba trăm chín mươi sáu phẩy sáu bốn tám, lúc mười bốn giờ ba mươi UTC. Major Low nằm ở ba nghìn ba trăm bảy mươi ba phẩy năm bốn năm, lúc mười lăm giờ mười lăm UTC. Kiểm thử trình duyệt xác nhận nhãn và đường mức giá tại đúng swing.',
        'Chúng tôi tiếp tục kiểm tra trên trình duyệt Chromium thực tế. Giao diện dùng một file HTML độc lập không kết nối mạng. Người thử có thể mở file, chọn tiếng Anh hoặc tiếng Việt, nhập file CSV mới và tua theo từng nến. Trong bài kiểm thử, một bộ dữ liệu inside bar ngẫu nhiên đã được nạp vào, và trạng thái Major cũng như Internal được hiển thị ở từng mốc. Không có lỗi JavaScript và không xuất hiện yêu cầu mạng nào trong phiên kiểm tra offline này.',
        f'Điểm quan trọng nhất là phân biệt quy tắc giá đóng cửa với cách ghép đỉnh đáy quan trọng. Có {g} trường hợp giá đóng đã ở ngoài mốc Major đang có hiệu lực nhưng không tạo giao cắt mới từ phía trong. Phiên bản năm chấm bốn đã bổ sung phép kiểm tra độc lập: giá đóng vượt Major đối ứng với sai số bằng không phải tạo tín hiệu S cộng, không đòi một lần giao cắt thứ hai. Riêng lựa chọn cặp Major giữa nhiều swing ứng viên vẫn là chính sách tạm thời, và được kiểm tra chéo với hai bộ dữ liệu XAU đã được chú thích.',
        'Để tái lập, chạy lệnh python scripts trên qa gate với tham số stress, require node và seed mặc định. Kết quả tạo file JSON, bảng HTML có thể lọc, bảng CSV từng ca, hình chụp trình duyệt và video chứng cứ. GitHub Actions tiếp tục kiểm tra Python, Node, định dạng dữ liệu trên Windows, giao diện Chromium và Docker build. Có thêm bài stress ngẫu nhiên cho các lần push và kiểm tra định kỳ. Video này được dựng từ các báo cáo chạy thật và hình chụp tự động, không phải bản trình diễn tưởng tượng. Các chính sách chưa rõ cần tiếp tục gắn nhãn và xác nhận theo PPT.'
    ]


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--report',default='qa-artifacts/stress-report.json');ap.add_argument('--output',default='qa-artifacts/MSAS_QA_Evidence_7min.mp4');args=ap.parse_args()
    check_tool('ffmpeg');check_tool('ffprobe');check_tool('espeak')
    src=ROOT/args.report
    report=json.loads(src.read_text('utf-8'))
    if report['status']!='PASS':raise RuntimeError('Cannot make success video from failing report')
    output=ROOT/args.output;output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.parent/'video-build';temp.mkdir(parents=True,exist_ok=True)
    chapters=scenes(report);voices=narrations(report)
    if len(chapters)!=len(voices):raise AssertionError('Chapter mismatch')
    timeline=[];video_inputs=[];current=0.0
    for i,(scene,speech) in enumerate(zip(chapters,voices)):
        still=temp/f'chapter_{i:02d}.png';wav=temp/f'chapter_{i:02d}.wav';clip=temp/f'chapter_{i:02d}.mp4'
        if clip.exists() and wav.exists() and duration(clip)>30:
            voice_d=duration(wav);show=duration(clip)
            timeline.append({'chapter':i+1,'title':scene['title'],'start_seconds':round(current,2),'duration_seconds':round(show,2),'voice_duration_seconds':round(voice_d,2),'source':scene['source']})
            video_inputs.append(clip);current+=show
            continue
        board(i,scene,report,still)
        call(['espeak','-v','vi','-s','148','-a','150','-w',str(wav),speech])
        voice_d=duration(wav)
        show=max(34.0, voice_d+2.0)
        # Keep each chapter on screen beyond its voice narration so tables can be read.
        if show>62:raise RuntimeError(f'Narration too long for chapter {i}: {voice_d:.1f}s')
        call(['ffmpeg','-hide_banner','-loglevel','error','-y', '-loop','1','-framerate','12','-i',str(still),'-i',str(wav),'-filter_complex','[1:a]apad=pad_dur=70[a]',
              '-map','0:v','-map','[a]','-t',f'{show:.2f}','-r','12','-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p','-c:a','aac','-ar','44100','-ac','1','-b:a','80k',str(clip)])
        timeline.append({'chapter':i+1,'title':scene['title'],'start_seconds':round(current,2),'duration_seconds':round(show,2),'voice_duration_seconds':round(voice_d,2),'source':scene['source']})
        video_inputs.append(clip);current+=show
    # Add a genuine 10-second Chromium interaction recording (not generated animation).
    real=EVIDENCE/'real-ui-interaction.webm'
    if real.exists():
        live=temp/'actual_browser_capture.mp4';length=min(10.0,duration(real))
        if not (live.exists() and duration(live)>8): call(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(real),'-f','lavfi','-i','anullsrc=channel_layout=mono:sample_rate=44100',
             '-t',f'{length:.2f}','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
             '-r','12','-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p','-c:a','aac','-b:a','80k','-ar','44100','-ac','1',str(live)])
        video_inputs.insert(9,live)
        timeline.insert(9,{'chapter':'real-capture','title':'Unedited Chromium interaction segment','start_seconds':round(sum(float(c['duration_seconds']) for c in timeline[:9]),2),'duration_seconds':length,'source':'Real Playwright-recorded webm'})
        current+=length
        # Recalculate timeline including the inserted short clip.
        cursor=0
        for entry in timeline:entry['start_seconds']=round(cursor,2);cursor+=float(entry['duration_seconds'])
    concat=temp/'files.txt';concat.write_text(''.join("file '"+str(p).replace("'","'\\''")+"'\n" for p in video_inputs))
    call(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','-movflags','+faststart',str(output)])
    final_d=duration(output)
    if not 300<=final_d<=600:raise RuntimeError(f'Wrong movie duration {final_d:.1f}; expected 5-10 minutes')
    manifest={'title':'MSAS QA evidence walkthrough','created_using':'Real Chromium screenshots and video, deterministic regression report, original Vietnamese eSpeak voice',
      'disclaimer':'Edited narrated QA walkthrough; recorded browser segment is explicitly labeled. No fabricated app results.',
      'sources':['REV S3-8','ADV S5-14','Basic Swing/Inside'],
      'report_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),
      'video_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
      'duration_seconds':round(final_d,2),'chapters':timeline,
      'narration':'eSpeak Vietnamese / locally generated, no user voice provided',
      'browser_recording_available':real.exists()}
    (output.parent/'video-evidence-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
    print('PASS QA evidence video:',output,'duration',round(final_d,1),'seconds','size',round(output.stat().st_size/1048576,1),'MiB')

if __name__=='__main__':main()
