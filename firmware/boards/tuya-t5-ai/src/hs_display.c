#include "tal_memory.h"
#include "tjpgd.h"
#include "hs_display.h"
#include "yard_gallery.h"
#include "../include/hs_avatar_themes.h"
#include "board_com_api.h"
#include "hs_runtime.h"
#include "wifi_profiles.h"
#include "hs_audio.h"
#include "hs_device_config.h"
#include "tal_kv.h"
#include "lv_vendor.h"
#include "lvgl.h"
#include "tal_mutex.h"
#include "tdd_disp_ili9488.h"
#include "tdd_touch_gt1151.h"
#include <stdio.h>
#include <string.h>
LV_FONT_DECLARE(hs_yard_font);
static MUTEX_HANDLE lock;
static hs_display_snapshot_t snapshot;
static void (*navigate)(int);
static bool session_listening,session_active;
void hs_t5_display_active(bool active){tal_mutex_lock(lock);session_active=active;tal_mutex_unlock(lock);}
static lv_obj_t *session_title;
void hs_t5_display_listening(bool active){tal_mutex_lock(lock);session_listening=active;tal_mutex_unlock(lock);}
static lv_obj_t *text_view, *content, *face, *mouth, *wifi_panel, *wifi_list, *wifi_message, *password, *keyboard;
static hs_wifi_ap_t selected_ap,visible_aps[HS_WIFI_SCAN_LIMIT];
static unsigned visible_count;
static lv_obj_t *password_panel,*password_network,*password_note,*password_visibility;
static unsigned wifi_revision;
static unsigned rendered;
static bool backend_connected,core_checking;
static hs_err_t core_check_error=HS_OK;
static lv_obj_t *core_panel,*core_status,*core_address,*core_retry;
void hs_t5_core_check_result(hs_err_t result){tal_mutex_lock(lock);core_checking=false;core_check_error=result;tal_mutex_unlock(lock);}
static void close_core(lv_event_t *e){(void)e;lv_obj_add_flag(core_panel,LV_OBJ_FLAG_HIDDEN);}
static void show_core(lv_event_t *e){
 (void)e;lv_obj_remove_flag(core_panel,LV_OBJ_FLAG_HIDDEN);
 hs_device_config_t config;hs_device_config_get(&config);
 lv_label_set_text(core_address,config.core_url[0]?config.core_url:"尚未配置服务地址");memset(&config,0,sizeof(config));
}
static void retry_core(lv_event_t *e){
 (void)e;tal_mutex_lock(lock);bool checking=core_checking;void (*callback)(int)=navigate;
 if(!checking&&callback){core_checking=true;core_check_error=HS_OK;}tal_mutex_unlock(lock);
 if(!checking&&callback)callback(20);
}

static lv_obj_t *backend_offline,*wifi_offline,*backend_icon,*wifi_icon,*settings_panel,*settings_status,*wifi_current;
typedef struct { unsigned version; bool silent,proactive,listening; int volume; } preferences_t;
static preferences_t preferences={1,false,true,true,60};
void hs_t5_preferences(bool *silent,bool *proactive,bool *listening){tal_mutex_lock(lock);*silent=preferences.silent;*proactive=preferences.proactive;*listening=preferences.listening;tal_mutex_unlock(lock);}
static lv_obj_t *offline_mark(lv_obj_t *b){
 lv_obj_t *mark=lv_label_create(b);lv_obj_set_style_text_font(mark,&lv_font_montserrat_14,0);lv_obj_set_style_text_color(mark,lv_color_hex(0xB94C4C),0);lv_label_set_text(mark,"/");lv_obj_center(mark);return mark;
}
void hs_t5_preferences_apply_volume(void){hs_audio_demo_volume((preferences.volume-hs_audio_volume_percent())/5);}

static void close_settings(lv_event_t *e){(void)e;lv_obj_add_flag(settings_panel,LV_OBJ_FLAG_HIDDEN);}
static void show_settings(lv_event_t *e){(void)e;lv_obj_remove_flag(settings_panel,LV_OBJ_FLAG_HIDDEN);}
static void preference_click(lv_event_t *e){
 int action=(int)(intptr_t)lv_event_get_user_data(e);
 tal_mutex_lock(lock);
 if(action==0)preferences.silent=!preferences.silent;
 if(action==1)preferences.proactive=!preferences.proactive;
 if(action==2)preferences.listening=!preferences.listening;
 tal_mutex_unlock(lock);
 if(action==3||action==4)hs_audio_demo_volume(action==3?-1:1);
 tal_mutex_lock(lock);preferences.volume=hs_audio_volume_percent();preferences_t saved=preferences;tal_mutex_unlock(lock);
 if(tal_kv_set("hs.yard.prefs.v1",(const uint8_t *)&saved,sizeof(saved)))lv_label_set_text(settings_status,"保存失败，请重试");
}

static int selected;
/* 独立登记同一块原厂 LCD，要求 SDK 在初始化时分配旋转缓冲区。
 * 仅在 LVGL 初始化之后修改 rotation 会缺少该缓冲区。引脚来自 V1.02 BSP。 */
static hs_err_t register_landscape(void) {
  DISP_RGB_DEVICE_CFG_T cfg = {0};
  cfg.sw_spi_cfg.spi_clk = TUYA_GPIO_NUM_49;
  cfg.sw_spi_cfg.spi_csx = TUYA_GPIO_NUM_48;
  cfg.sw_spi_cfg.spi_sda = TUYA_GPIO_NUM_50;
  cfg.sw_spi_cfg.spi_dc = TUYA_GPIO_NUM_MAX;
  cfg.sw_spi_cfg.spi_rst = TUYA_GPIO_NUM_53;
  cfg.bl.type = TUYA_DISP_BL_TP_GPIO;
  cfg.bl.gpio.pin = TUYA_GPIO_NUM_9;
  cfg.bl.gpio.active_level = TUYA_GPIO_LEVEL_HIGH;
  cfg.width = 320;
  cfg.height = 480;
  cfg.pixel_fmt = TUYA_PIXEL_FMT_RGB565;
  cfg.rotation = TUYA_DISPLAY_ROTATION_90;
  cfg.power.pin = TUYA_GPIO_NUM_MAX;
  if (tdd_disp_rgb_ili9488_register("homestash-t5-lcd", &cfg) != OPRT_OK)
    return HS_FAIL;
  /* SDK 按同一个名字查找显示与触摸设备，保留物理坐标给 LVGL 旋转。 */
  TDD_TOUCH_GT1151_INFO_T touch = {
      .i2c_cfg = {.port = TUYA_I2C_NUM_0,
                  .scl_pin = TUYA_GPIO_NUM_13,
                  .sda_pin = TUYA_GPIO_NUM_15},
      .tp_cfg = {.x_max = 320, .y_max = 480}};
  return tdd_touch_i2c_gt1151_register("homestash-t5-lcd", &touch) == OPRT_OK
             ? HS_OK
             : HS_FAIL;
}
static void clicked(lv_event_t *e) {
  int page = (int)(intptr_t)lv_event_get_user_data(e);
  tal_mutex_lock(lock);
  void (*callback)(int) = navigate;
  tal_mutex_unlock(lock);
  if (callback)
    callback(page);
}
/* Wi-Fi 凭据只在设备输入，不回显日志；复用原网络服务及持久化。 */
/* 键盘构造器默认底部居中；必须显式采用左上坐标，避免向下偏移出屏。 */
static void show_password_keyboard(lv_event_t *e){
 (void)e;
 lv_obj_move_foreground(password_panel);
 lv_keyboard_set_textarea(keyboard,password);
 lv_obj_remove_flag(keyboard,LV_OBJ_FLAG_HIDDEN);
 lv_obj_move_foreground(keyboard);
 lv_obj_add_state(password,LV_STATE_FOCUSED);
}
static void back_to_networks(lv_event_t *e);
static void password_keyboard_event(lv_event_t *e){
 lv_event_code_t code=lv_event_get_code(e);
 if(code==LV_EVENT_CANCEL){back_to_networks(NULL);return;}
 if(code==LV_EVENT_READY){
   lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);
   lv_keyboard_set_textarea(keyboard,NULL);
   lv_obj_remove_state(password,LV_STATE_FOCUSED);
 }
}
static void close_wifi(lv_event_t *e) {
  (void)e;
  if(password)lv_textarea_set_text(password, "");
  lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(wifi_panel, LV_OBJ_FLAG_HIDDEN);
}
static void back_to_networks(lv_event_t *e){
 (void)e;lv_textarea_set_text(password, "");lv_textarea_set_password_mode(password,true);
 lv_label_set_text(lv_obj_get_child(password_visibility,0),"显示");
 lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
 lv_keyboard_set_textarea(keyboard,NULL);
 lv_obj_remove_state(password,LV_STATE_FOCUSED);
}
static void toggle_password(lv_event_t *e){
 (void)e;bool hidden=lv_textarea_get_password_mode(password);lv_textarea_set_password_mode(password,!hidden);
 lv_label_set_text(lv_obj_get_child(password_visibility,0),hidden?"隐藏":"显示");
 show_password_keyboard(NULL);
}
static void connect_wifi(lv_event_t *e) {
 (void)e;
 hs_err_t result=hs_wifi_connect_remember(&selected_ap,lv_textarea_get_text(password),true);
 if(result!=HS_OK){lv_label_set_text(password_note,"连接未开始，请检查密码");return;}
 lv_textarea_set_text(password, "");lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
 lv_label_set_text(wifi_message,"正在连接，成功后自动保存");
}
static void choose_wifi(lv_event_t *e) {
 unsigned index=(unsigned)(uintptr_t)lv_event_get_user_data(e);
 if(index>=visible_count)return;
 selected_ap=visible_aps[index];
 lv_label_set_text(password_network,selected_ap.ssid);
 lv_textarea_set_text(password, "");lv_textarea_set_password_mode(password,true);
 lv_label_set_text(lv_obj_get_child(password_visibility,0),"显示");
 lv_label_set_text(password_note,selected_ap.enterprise?"暂不支持企业认证网络":selected_ap.open?"开放网络，无需输入密码":"输入密码，连接后自动保存");
 lv_obj_remove_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
 lv_keyboard_set_mode(keyboard,LV_KEYBOARD_MODE_TEXT_LOWER);
 show_password_keyboard(NULL);
}
static void scan_wifi(lv_event_t *e){
 (void)e;hs_err_t result=hs_wifi_scan();lv_label_set_text(wifi_message,result==HS_OK?"正在寻找附近网络…":"暂时无法扫描，请稍后重试");
}
static void show_wifi(lv_event_t *e){
 (void)e;lv_obj_remove_flag(wifi_panel,LV_OBJ_FLAG_HIDDEN);wifi_revision=(unsigned)-1;scan_wifi(NULL);
}
static lv_obj_t *button(lv_obj_t *parent,const char *title,int x,int y,int w,lv_event_cb_t cb,void *data){
  lv_obj_t *b=lv_button_create(parent);lv_obj_set_pos(b,x,y);lv_obj_set_size(b,w,44);
  lv_obj_set_style_bg_color(b,lv_color_hex(0xF5D8CC),0);
  lv_obj_set_style_text_color(b,lv_color_hex(0x49382F),0);
  lv_obj_add_event_cb(b,cb,LV_EVENT_CLICKED,data);
  lv_obj_t *l=lv_label_create(b);if(title[0]&&(unsigned char)title[0]>=0xEF)lv_obj_set_style_text_font(l,&lv_font_montserrat_14,0);lv_label_set_text(l,title);lv_obj_center(l);return b;
}
/* 所有对象只创建一次；业务线程只提交快照，50ms动画定时器在LVGL线程绘制。 */
static lv_obj_t *eye[2],*pupil[2],*shine[2],*cheek[2],*brow[2],*avatar_toggle,*avatar_stop,*avatar_status,*avatar_color;
static lv_obj_t *wallpaper_view, *photos_button;
static uint16_t *wallpaper_pending;
static bool wallpaper_changed, wallpaper_offer;
static lv_image_dsc_t wallpaper_image = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565,
        .w = 480,
        .h = 320,
        .stride = 480 * sizeof(uint16_t),
    },
    .data_size = 480 * 320 * sizeof(uint16_t),
};
static lv_obj_t *photo_preview_panel, *photo_preview_view, *photo_preview_empty, *photo_preview_wallpaper;
static uint16_t *photo_preview_pending;
static lv_image_dsc_t photo_preview_image = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565,
        .w = 320,
        .h = 240,
        .stride = 320 * sizeof(uint16_t),
    },
    .data_size = 320 * 240 * sizeof(uint16_t),
};
static unsigned avatar_base_children;
static int avatar_state=HS_FACE_IDLE;
static uint32_t avatar_epoch;
typedef struct {unsigned version,revision;int theme,fullscreen;} avatar_config_t;
static avatar_config_t avatar_config={1,0,0,0};
static bool avatar_dirty;
static uint8_t sticker_color;
static bool sticker_color_dirty;
static void avatar_color_click(lv_event_t *event){
 (void)event;
 tal_mutex_lock(lock);
 sticker_color=(sticker_color+1)%4;
 sticker_color_dirty=true;
 tal_mutex_unlock(lock);
}
static void avatar_heart(lv_event_t *event){
 tal_mutex_lock(lock);int state=avatar_state,theme=avatar_config.theme;tal_mutex_unlock(lock);
 if(state!=HS_FACE_LOVE)return;
 lv_obj_t *obj=lv_event_get_target(event);lv_area_t a;lv_obj_get_coords(obj,&a);int w=lv_area_get_width(&a),h=lv_area_get_height(&a);lv_layer_t *layer=lv_event_get_layer(event);
 lv_draw_triangle_dsc_t tri;lv_draw_triangle_dsc_init(&tri);tri.bg_color=lv_color_hex(avatar_themes[theme].accent);tri.bg_opa=LV_OPA_COVER;
 tri.p[0]=(lv_point_precise_t){a.x1,a.y1+h/3};tri.p[1]=(lv_point_precise_t){a.x2,a.y1+h/3};tri.p[2]=(lv_point_precise_t){a.x1+w/2,a.y2};lv_draw_triangle(layer,&tri);
 lv_draw_rect_dsc_t circle;lv_draw_rect_dsc_init(&circle);circle.bg_color=tri.bg_color;circle.bg_opa=LV_OPA_COVER;circle.radius=LV_RADIUS_CIRCLE;
 lv_area_t left={a.x1,a.y1,a.x1+w/2,a.y1+h/2},right={a.x1+w/2,a.y1,a.x2,a.y1+h/2};lv_draw_rect(layer,&circle,&left);lv_draw_rect(layer,&circle,&right);
}
void hs_t5_avatar_config(unsigned revision,int theme,int fullscreen){
 if(theme<0||theme>=4||(fullscreen!=0&&fullscreen!=1))return;
 tal_mutex_lock(lock);
 if(revision>avatar_config.revision){avatar_config=(avatar_config_t){1,revision,theme,fullscreen};avatar_dirty=true;}
 tal_mutex_unlock(lock);
}
static void fullscreen_icon(lv_event_t *e){
 tal_mutex_lock(lock);bool full=avatar_config.fullscreen;tal_mutex_unlock(lock);if(full)return;
 lv_obj_t *o=lv_event_get_target(e);lv_area_t a;lv_obj_get_coords(o,&a);lv_draw_rect_dsc_t d;lv_draw_rect_dsc_init(&d);d.bg_color=lv_color_hex(0x365E58);d.bg_opa=LV_OPA_COVER;
 for(int i=0;i<4;i++){int x=a.x1+(i&1?26:12),y=a.y1+(i&2?26:12);lv_area_t h={x,y,x+7,y+1};lv_draw_rect(lv_event_get_layer(e),&d,&h);lv_area_t v={x+(i&1?6:0),y+(i&2?-6:0),x+(i&1?7:1),y+(i&2?1:7)};lv_draw_rect(lv_event_get_layer(e),&d,&v);}
}
static void avatar_toggle_click(lv_event_t *e){(void)e;tal_mutex_lock(lock);avatar_config.fullscreen=!avatar_config.fullscreen;avatar_dirty=true;tal_mutex_unlock(lock);}
static lv_obj_t *avatar_part(lv_obj_t *parent){lv_obj_t *o=lv_obj_create(parent);lv_obj_remove_flag(o,LV_OBJ_FLAG_SCROLLABLE);lv_obj_remove_flag(o,LV_OBJ_FLAG_CLICKABLE);lv_obj_set_style_border_width(o,0,0);lv_obj_set_style_pad_all(o,0,0);lv_obj_set_style_radius(o,LV_RADIUS_CIRCLE,0);return o;}
static void shape(lv_obj_t *o,int x,int y,int w,int h,unsigned color,int radius){lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,h);lv_obj_set_style_bg_color(o,lv_color_hex(color),0);lv_obj_set_style_radius(o,radius,0);}
#include "../assets/avatar-stickers.inc"
__asm__(".pushsection .rodata.hs_stickers,\"a\",%progbits\n"
        ".global hs_sticker_data\nhs_sticker_data:\n"
        ".incbin \"" HS_STICKER_BIN "\"\n.popsection\n");
extern const uint8_t hs_sticker_data[];

static lv_obj_t *sticker_image;
static uint16_t *sticker_pixels;
static lv_image_dsc_t sticker_image_source = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565A8,
        .w = HS_STICKER_SIZE,
        .h = HS_STICKER_SIZE,
        .stride = HS_STICKER_SIZE * sizeof(uint16_t),
    },
    .data_size = HS_STICKER_SIZE * HS_STICKER_SIZE * 3,
};

typedef struct {
    const uint8_t *next;
    size_t remaining;
} sticker_stream_t;

static size_t sticker_read(JDEC *decoder, uint8_t *out, size_t size) {
    sticker_stream_t *stream = decoder->device;
    if (size > stream->remaining) size = stream->remaining;
    if (out) memcpy(out, stream->next, size);
    stream->next += size;
    stream->remaining -= size;
    return size;
}

typedef struct {
    sticker_stream_t stream;
    uint16_t *pixels;
    unsigned width;
    unsigned step;
} wallpaper_decode_t;

static int wallpaper_write(JDEC *decoder, void *rgb, JRECT *rect) {
    wallpaper_decode_t *photo = decoder->device;
    for (unsigned y = rect->top; y <= rect->bottom; ++y) {
        if (y % photo->step) continue;
        unsigned block_width = rect->right - rect->left + 1;
        for (unsigned x = rect->left; x <= rect->right; ++x) {
            if (x % photo->step) continue;
            const uint8_t *pixel = (const uint8_t *)rgb +
                ((y - rect->top) * block_width + x - rect->left) * 3;
            photo->pixels[(y / photo->step) * photo->width + x / photo->step] =
                ((pixel[2] & 0xf8) << 8) | ((pixel[1] & 0xfc) << 3) | (pixel[0] >> 3);
        }
    }
    return 1;
}

static uint16_t *decode_photo(const uint8_t *jpeg, size_t length,
                              const lv_image_dsc_t *image, unsigned step) {
    uint16_t *pixels = tal_psram_malloc(image->data_size);
    if (!pixels) return NULL;
    uint32_t work[1024];
    wallpaper_decode_t photo = {{jpeg, length}, pixels, image->header.w, step};
    JDEC decoder;
    if (jd_prepare(&decoder, sticker_read, work, sizeof(work), &photo) != JDR_OK ||
        decoder.width != image->header.w * step ||
        decoder.height != image->header.h * step ||
        jd_decomp(&decoder, wallpaper_write, 0) != JDR_OK) {
        tal_psram_free(pixels);
        return NULL;
    }
    return pixels;
}

static char photo_preview_id[37], photo_preview_pending_id[37];

bool hs_t5_photo_preview(const uint8_t *jpeg, size_t length, const char *id) {
    uint16_t *pixels = decode_photo(jpeg, length, &photo_preview_image, 2);
    if (!pixels) return false;
    tal_mutex_lock(lock);
    uint16_t *discarded = photo_preview_pending;
    photo_preview_pending = pixels;
    snprintf(photo_preview_pending_id, sizeof(photo_preview_pending_id), "%s", id);
    tal_mutex_unlock(lock);
    if (discarded) tal_psram_free(discarded);
    return true;
}

static void photo_preview_close(lv_event_t *event) {
    (void)event;
    lv_obj_add_flag(photo_preview_panel, LV_OBJ_FLAG_HIDDEN);
}

static void photo_preview_open(lv_event_t *event) {
    (void)event;
    lv_obj_move_foreground(photo_preview_panel);
    lv_obj_remove_flag(photo_preview_panel, LV_OBJ_FLAG_HIDDEN);
}

static void photo_preview_set_wallpaper(lv_event_t *event) {
    photo_preview_close(event);
    clicked(event);
}

static lv_obj_t *gallery_panel, *gallery_view, *gallery_story, *gallery_title;
static lv_obj_t *gallery_prev, *gallery_next, *gallery_latest, *gallery_retry, *gallery_generate;
static lv_image_dsc_t gallery_image = {
    .header = {.magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_RGB565,
               .w = 240, .h = 160, .stride = 240 * sizeof(uint16_t)},
    .data_size = 240 * 160 * sizeof(uint16_t),
};
static yard_gallery_request_t gallery_query;
static yard_gallery_page_t gallery_page, gallery_incoming;
static unsigned gallery_revision, gallery_received;
static bool gallery_requested, gallery_ready, gallery_failed, gallery_loading, gallery_photos;
static uint16_t *gallery_pixels;
static bool gallery_from_story;
static unsigned gallery_story_index;

bool hs_t5_gallery_take_request(yard_gallery_request_t *request) {
    tal_mutex_lock(lock);
    bool pending = gallery_requested;
    if (pending) *request = gallery_query;
    gallery_requested = false;
    tal_mutex_unlock(lock);
    return pending;
}

void hs_t5_gallery_result(unsigned revision, const yard_gallery_page_t *page,
                          const uint8_t *jpeg, size_t length) {
    uint16_t *pixels = jpeg ? decode_photo(jpeg, length, &gallery_image, 1) : NULL;
    tal_mutex_lock(lock);
    uint16_t *old = gallery_pixels;
    gallery_pixels = pixels;
    gallery_received = revision;
    gallery_failed = !page;
    if (page) gallery_incoming = *page;
    gallery_ready = true;
    tal_mutex_unlock(lock);
    if (old) tal_psram_free(old);
}

static void gallery_clear_image(void) {
    lv_obj_add_flag(gallery_view, LV_OBJ_FLAG_HIDDEN);
    lv_image_set_src(gallery_view, NULL);
    lv_image_cache_drop(&gallery_image);
    if (gallery_image.data) tal_psram_free((void *)gallery_image.data);
    gallery_image.data = NULL;
}

static void gallery_request(bool photos, unsigned index, const char *anchor, bool generate) {
    gallery_photos = photos;
    gallery_loading = true;
    gallery_clear_image();
    lv_label_set_text(gallery_title, photos ? "照片" : "回忆");
    lv_obj_set_pos(gallery_story, 64, 85);
    lv_obj_set_width(gallery_story, 352);
    lv_label_set_text(gallery_story, generate ? "正在生成回忆…" : "正在加载…");
    lv_obj_add_flag(gallery_generate, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_state(gallery_prev, LV_STATE_DISABLED);
    lv_obj_add_state(gallery_next, LV_STATE_DISABLED);
    lv_obj_add_flag(gallery_retry, LV_OBJ_FLAG_HIDDEN);
    if (photos && photo_preview_image.data) lv_obj_remove_flag(gallery_latest, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(gallery_latest, LV_OBJ_FLAG_HIDDEN);
    tal_mutex_lock(lock);
    gallery_query = (yard_gallery_request_t){.revision = ++gallery_revision,
                                             .index = index, .photos = photos, .generate = generate};
    if (anchor) snprintf(gallery_query.anchor, sizeof(gallery_query.anchor), "%s", anchor);
    gallery_requested = true;
    tal_mutex_unlock(lock);
}

static void gallery_open(lv_event_t *e) {
    gallery_from_story = false;
    lv_obj_move_foreground(gallery_panel);
    lv_obj_remove_flag(gallery_panel, LV_OBJ_FLAG_HIDDEN);
    gallery_request(lv_event_get_user_data(e) != NULL, 0, NULL, false);
}

static void gallery_close(lv_event_t *e) {
    (void)e;
    lv_obj_add_flag(gallery_panel, LV_OBJ_FLAG_HIDDEN);
    gallery_clear_image();
    tal_mutex_lock(lock);
    gallery_requested = false;
    ++gallery_revision;
    tal_mutex_unlock(lock);
}

static void gallery_back(lv_event_t *e) {
    if (!gallery_from_story) {
        gallery_close(e);
        return;
    }
    gallery_from_story = false;
    gallery_request(false, gallery_story_index, NULL, false);
}

static void gallery_retry_click(lv_event_t *e) {
    (void)e;
    yard_gallery_request_t previous = gallery_query;
    gallery_request(gallery_photos, previous.index, previous.anchor, previous.generate);
}

static void gallery_turn(int direction) {
    if (gallery_loading || !gallery_page.count) return;
    int next = (int)gallery_page.index + direction;
    if (next >= 0 && (unsigned)next < gallery_page.count)
        gallery_request(gallery_photos, next, NULL, false);
}

static void gallery_turn_click(lv_event_t *e) {
    gallery_turn((int)(intptr_t)lv_event_get_user_data(e));
}

static void gallery_gesture(lv_event_t *e) {
    (void)e;
    lv_indev_t *input = lv_indev_active();
    if (!input) return;
    lv_dir_t direction = lv_indev_get_gesture_dir(input);
    if (direction != LV_DIR_LEFT && direction != LV_DIR_RIGHT) return;
    lv_indev_wait_release(input);
    gallery_turn(direction == LV_DIR_LEFT ? 1 : -1);
}

static void gallery_image_click(lv_event_t *e) {
    (void)e;
    if (!gallery_loading && !gallery_photos && gallery_page.id[0]) {
        gallery_from_story = true;
        gallery_story_index = gallery_page.index;
        gallery_request(true, 0, gallery_page.id, false);
    }
}

static void gallery_generate_click(lv_event_t *e) {
    bool preview = lv_event_get_user_data(e) != NULL;
    if (!preview && (gallery_loading || !gallery_photos || !gallery_page.id[0])) return;
    const char *id = preview ? photo_preview_id : gallery_page.id;
    if (!id[0]) return;
    if (preview) photo_preview_close(e);
    gallery_from_story = false;
    lv_obj_move_foreground(gallery_panel);
    lv_obj_remove_flag(gallery_panel, LV_OBJ_FLAG_HIDDEN);
    gallery_request(false, 0, id, true);
}

static void gallery_latest_click(lv_event_t *e) {
    gallery_close(e);
    photo_preview_open(e);
}

static void gallery_tick(void) {
    tal_mutex_lock(lock);
    if (!gallery_ready) {
        tal_mutex_unlock(lock);
        return;
    }
    bool current = gallery_received == gallery_revision;
    bool failed = gallery_failed;
    yard_gallery_page_t page = gallery_incoming;
    uint16_t *pixels = gallery_pixels;
    gallery_pixels = NULL;
    gallery_ready = false;
    tal_mutex_unlock(lock);
    if (!current || lv_obj_has_flag(gallery_panel, LV_OBJ_FLAG_HIDDEN)) {
        if (pixels) tal_psram_free(pixels);
        return;
    }
    gallery_loading = false;
    gallery_page = failed ? (yard_gallery_page_t){0} : page;
    if (failed || !page.count) {
        lv_label_set_text(gallery_story, failed ? (gallery_query.generate ? "生成失败，请确认联网后重试" : "加载失败，请重试") :
            gallery_photos ? "还没有照片" : "还没有回忆，可在照片中生成");
        if (failed) lv_obj_remove_flag(gallery_retry, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    char title[80];
    snprintf(title, sizeof(title), "%s  %s  %u / %u",
             gallery_photos ? "照片" : "回忆", page.date, page.index + 1, page.count);
    lv_label_set_text(gallery_title, title);
    lv_obj_set_pos(gallery_view, gallery_photos ? 120 : 16, 75);
    if (!gallery_photos && page.id[0]) {
        lv_obj_set_pos(gallery_story, 265, 50);
        lv_obj_set_width(gallery_story, 205);
    }
    lv_label_set_text(gallery_story, gallery_photos ? (pixels ? "" : "照片暂不可用") :
                      page.story);
    if (!pixels && page.id[0]) lv_obj_remove_flag(gallery_retry, LV_OBJ_FLAG_HIDDEN);
    if (pixels) {
        if (gallery_photos) lv_obj_remove_flag(gallery_generate, LV_OBJ_FLAG_HIDDEN);
        gallery_image.data = (const uint8_t *)pixels;
        lv_image_set_src(gallery_view, &gallery_image);
        lv_obj_remove_flag(gallery_view, LV_OBJ_FLAG_HIDDEN);
    }
    if (page.index) lv_obj_remove_state(gallery_prev, LV_STATE_DISABLED);
    if (page.index + 1 < page.count) lv_obj_remove_state(gallery_next, LV_STATE_DISABLED);
}

static void photo_preview_tick(void) {
    tal_mutex_lock(lock);
    uint16_t *pixels = photo_preview_pending;
    photo_preview_pending = NULL;
    if (pixels) memcpy(photo_preview_id, photo_preview_pending_id, sizeof(photo_preview_id));
    tal_mutex_unlock(lock);
    if (!pixels) return;
    const uint8_t *old = photo_preview_image.data;
    lv_image_cache_drop(&photo_preview_image);
    photo_preview_image.data = (const uint8_t *)pixels;
    lv_image_set_src(photo_preview_view, &photo_preview_image);
    lv_obj_invalidate(photo_preview_view);
    if (old) tal_psram_free((void *)old);
    lv_obj_add_flag(photo_preview_empty, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(photo_preview_wallpaper, LV_OBJ_FLAG_HIDDEN);
    photo_preview_open(NULL);
}

bool hs_t5_wallpaper_set(const uint8_t *jpeg, size_t length) {
    uint16_t *pixels = jpeg ? decode_photo(jpeg, length, &wallpaper_image, 1) : NULL;
    if (jpeg && !pixels) return false;
    tal_mutex_lock(lock);
    uint16_t *discarded = wallpaper_pending;
    wallpaper_pending = pixels;
    wallpaper_changed = true;
    tal_mutex_unlock(lock);
    if (discarded) tal_psram_free(discarded);
    return true;
}

void hs_t5_wallpaper_offer(bool available) {
    tal_mutex_lock(lock);
    wallpaper_offer = available;
    tal_mutex_unlock(lock);
}

static bool wallpaper_tick(bool active, bool fullscreen, bool full_bubble) {
    tal_mutex_lock(lock);
    bool changed = wallpaper_changed;
    bool offered = wallpaper_offer;
    uint16_t *pixels = wallpaper_pending;
    wallpaper_changed = false;
    wallpaper_pending = NULL;
    tal_mutex_unlock(lock);
    if (changed) {
        const uint8_t *old = wallpaper_image.data;
        lv_image_cache_drop(&wallpaper_image);
        wallpaper_image.data = (const uint8_t *)pixels;
        lv_image_set_src(wallpaper_view, pixels ? &wallpaper_image : NULL);
        lv_obj_invalidate(wallpaper_view);
        if (old) tal_psram_free((void *)old);
    }
    bool visible = !active && wallpaper_image.data;
    if (visible) lv_obj_remove_flag(wallpaper_view, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(wallpaper_view, LV_OBJ_FLAG_HIDDEN);
    if (!fullscreen) lv_obj_remove_flag(photos_button, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(photos_button, LV_OBJ_FLAG_HIDDEN);
    if ((visible && !offered) || (fullscreen && !full_bubble)) lv_obj_add_flag(text_view, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_remove_flag(text_view, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_style_bg_opa(session_title, visible ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
    if (visible) lv_obj_add_flag(avatar_status, LV_OBJ_FLAG_HIDDEN);
    else if (fullscreen) lv_obj_remove_flag(avatar_status, LV_OBJ_FLAG_HIDDEN);
    return visible;
}

static uint16_t sticker_rgb565(uint8_t blue, uint8_t green, uint8_t red) {
    unsigned r=red,g=green,b=blue;
    if(sticker_color && r>g+10 && g>b+5 && r>110) {
        unsigned warm_r=r-b,warm_g=g-b;
        if(sticker_color==1) { g=b+warm_g/3; b+=warm_g; }
        else if(sticker_color==2) { r=b+warm_g/4; g=b+warm_r; b+=warm_g; }
        else { r=b+warm_g; g=b+warm_g/2; b+=warm_r; }
    }
    return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

static int sticker_write(JDEC *decoder, void *rgb, JRECT *rect) {
    (void)decoder;
    const uint8_t *pixel = rgb;
    for (unsigned y = rect->top; y <= rect->bottom; ++y) {
        uint16_t *out = sticker_pixels + y * HS_STICKER_SIZE + rect->left;
        for (unsigned x = rect->left; x <= rect->right; ++x, pixel += 3)
            /* 锁定 SDK 的 TJpgDec 按 B、G、R 顺序输出。 */
            *out++ = sticker_rgb565(pixel[0],pixel[1],pixel[2]);
    }
    return 1;
}

static bool sticker_decode(uint32_t offset) {
    static uint32_t work[1024];
    const uint8_t *entry = hs_sticker_data + offset;
    sticker_stream_t stream = {entry + 2, entry[0] | (entry[1] << 8)};
    JDEC decoder;
    if (jd_prepare(&decoder, sticker_read, work, sizeof(work), &stream) != JDR_OK ||
        decoder.width != HS_STICKER_SIZE || decoder.height != HS_STICKER_SIZE ||
        jd_decomp(&decoder, sticker_write, 0) != JDR_OK) return false;
    const uint8_t *mask = entry + 2 + (entry[0] | (entry[1] << 8));
    uint8_t *alpha = (uint8_t *)(sticker_pixels + HS_STICKER_SIZE * HS_STICKER_SIZE);
    unsigned written = 0;
    while(written < HS_STICKER_SIZE * HS_STICKER_SIZE) {
        unsigned count = (mask[0] & 63) + 1;
        if(count > HS_STICKER_SIZE * HS_STICKER_SIZE - written) return false;
        memset(alpha + written, (mask[0] >> 6) * 85, count);
        written += count;
        mask++;
    }
    return true;
}

static void sticker_render(int state, uint32_t age, int scale) {
    static uint32_t last_offset = UINT32_MAX;
    static int last_scale = -1;
    static int last_color = -1;
    unsigned clip = sticker_by_state[state];
    unsigned frame_ms = state == HS_FACE_SPEAK ? 100 : sticker_clips[clip].frame_ms;
    unsigned frame = (age / frame_ms) % sticker_clips[clip].count;
    uint32_t offset = sticker_clips[clip].offsets[frame];

    if (last_offset != offset || last_color != sticker_color) {
        if (!sticker_decode(offset)) return;
        last_offset = offset;
        last_color = sticker_color;
        lv_image_cache_drop(&sticker_image_source);
        lv_obj_invalidate(sticker_image);
    }
    if (last_scale != scale) {
        last_scale = scale;
        lv_image_set_scale(sticker_image, scale);
    }
}

static void avatar_tick(lv_timer_t *timer){
 (void)timer;tal_mutex_lock(lock);avatar_config_t c=avatar_config;int state=avatar_state;uint32_t epoch=avatar_epoch;bool dirty=avatar_dirty;avatar_dirty=false;tal_mutex_unlock(lock);
 tal_mutex_lock(lock);bool color_dirty=sticker_color_dirty;sticker_color_dirty=false;uint8_t color=sticker_color;tal_mutex_unlock(lock);
 if(color_dirty)tal_kv_set("hs.bear.color",&color,sizeof(color));
 if(dirty)tal_kv_set("hs.avatar.v1",(const uint8_t *)&c,sizeof(c));
 const hs_avatar_theme_t *t=&avatar_themes[c.theme];
 static int layout=-1;
 if(layout!=c.fullscreen){layout=c.fullscreen;lv_obj_t *screen=lv_screen_active();
  for(unsigned i=0;i<avatar_base_children;i++){lv_obj_t *o=lv_obj_get_child(screen,i);if(o==face||o==avatar_toggle||o==avatar_stop||o==avatar_status||o==avatar_color||o==wallpaper_view||o==photos_button)continue;if(layout)lv_obj_add_flag(o,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(o,LV_OBJ_FLAG_HIDDEN);}
  if(layout)lv_obj_remove_flag(avatar_status,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(avatar_status,LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(lv_obj_get_child(avatar_toggle,0),layout?LV_SYMBOL_LEFT:"");lv_obj_set_pos(avatar_toggle,layout?424:158,layout?8:46);lv_obj_set_pos(avatar_stop,layout?372:106,layout?8:46);lv_obj_set_pos(avatar_color,layout?320:54,layout?8:46);
 }
 tal_mutex_lock(lock);bool active=session_active;tal_mutex_unlock(lock);
 bool full_bubble=c.fullscreen&&active&&
   (state==HS_FACE_THINK||state==HS_FACE_SPEAK||state==HS_FACE_HAPPY);
 static int last_bubble_layout=-1;
 if(last_bubble_layout!=full_bubble){
  last_bubble_layout=full_bubble;
  lv_obj_set_pos(text_view,full_bubble?34:216,full_bubble?217:92);
  lv_obj_set_size(text_view,full_bubble?412:246,full_bubble?96:156);
 }
 photo_preview_tick();
 gallery_tick();
 bool show_wallpaper=wallpaper_tick(active,c.fullscreen,full_bubble);
 if(show_wallpaper)lv_obj_add_flag(face,LV_OBJ_FLAG_HIDDEN);
 else lv_obj_remove_flag(face,LV_OBJ_FLAG_HIDDEN);
 if(active)lv_obj_remove_flag(avatar_stop,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(avatar_stop,LV_OBJ_FLAG_HIDDEN);
 uint32_t age=lv_tick_get()-epoch;int phase=(age/50)%40;int wave=phase<20?phase:40-phase;int bob=(wave-10)/4;
 int w=c.fullscreen?260:184,h=c.fullscreen?232:166;int x=c.fullscreen?110:20,y=(c.fullscreen?52:82)+bob;
 if(state==HS_FACE_WAKE&&age<600)x+=(age/100)%2?6:-6;
 if(state==HS_FACE_ANGRY)x+=(age/120)%2?3:-3;
 bool show_sticker=c.theme==0 && sticker_pixels;
 if(show_sticker)y=c.fullscreen?52:82;
 if(full_bubble){y=38;h=172;}
 if(state==HS_FACE_SPEAK){
  static const int bounce[]={0,-2,-4,-2,0,2,3,2};
  y+=bounce[(age/50)%8];
  x+=bounce[(age/50+2)%8];
 }
 shape(face,x,y,w,h,t->body,t->radius);
 lv_obj_set_style_bg_opa(face,show_sticker?LV_OPA_TRANSP:LV_OPA_COVER,0);
 if(show_sticker&&!show_wallpaper)lv_obj_remove_flag(avatar_color,LV_OBJ_FLAG_HIDDEN);
 else lv_obj_add_flag(avatar_color,LV_OBJ_FLAG_HIDDEN);
 if(sticker_image){
  if(show_sticker)lv_obj_remove_flag(sticker_image,LV_OBJ_FLAG_HIDDEN);
  else lv_obj_add_flag(sticker_image,LV_OBJ_FLAG_HIDDEN);
 }
 lv_obj_t *parts[]={eye[0],eye[1],cheek[0],cheek[1],brow[0],brow[1],mouth};
 for(unsigned i=0;i<sizeof(parts)/sizeof(parts[0]);i++){
  if(show_sticker)lv_obj_add_flag(parts[i],LV_OBJ_FLAG_HIDDEN);
  else lv_obj_remove_flag(parts[i],LV_OBJ_FLAG_HIDDEN);
 }
 if(show_wallpaper) return;
 if(show_sticker) sticker_render(state,age,full_bubble?192:c.fullscreen?256:171);
 else {

 int ew=t->eye_width,eh=t->eye_height;if(c.fullscreen){ew=ew*3/2;eh=eh*3/2;}
 bool blink=(age%4200)>4000;
 if(state==HS_FACE_SLEEP)eh=8;else if(blink)eh=4;
 if(state==HS_FACE_HAPPY)eh=8;
 for(int i=0;i<2;i++){
  int ex=w*(i?68:32)/100-ew/2,ey=h*35/100;
  shape(eye[i],ex,ey,ew,eh,0xFFFFFF,ew/2);
  lv_obj_set_style_bg_opa(eye[i],state==HS_FACE_LOVE?LV_OPA_TRANSP:LV_OPA_COVER,0);
  if(state==HS_FACE_LOVE){lv_obj_add_flag(pupil[i],LV_OBJ_FLAG_HIDDEN);}else{lv_obj_remove_flag(pupil[i],LV_OBJ_FLAG_HIDDEN);}
  lv_obj_invalidate(eye[i]);
  int pw=ew*2/3,ph=eh*3/4;if(state==HS_FACE_SURPRISE)pw=ew/2;
  shape(pupil[i],(ew-pw)/2+(state==HS_FACE_THINK?(wave-10)/5:0),(eh-ph)/2,pw,ph,t->ink,pw/2);
  shape(shine[i],pw/4,ph/6,ph>8?6:1,ph>8?7:1,0xFFFFFF,4);
  shape(cheek[i],ex-3,h*65/100,ew+6,9,t->accent,6);
  shape(brow[i],ex,ey-13+(state==HS_FACE_ANGRY?(i?4:0):0),ew,state==HS_FACE_ANGRY?6:2,t->ink,3);
 }
 int mh=state==HS_FACE_SPEAK?8+(age/100%4)*5:state==HS_FACE_SURPRISE?30:state==HS_FACE_HAPPY?18:8;
 shape(mouth,w/2-15,h*67/100,30,mh,t->ink,12);
 }
 static const char *labels[]={"陪着你","醒来啦","正在听","正在想","正在说","好开心","哇","喜欢你","休息中","哼哼","准备拍照","请检查连接"};
 lv_label_set_text(avatar_status,labels[state]);
}
static void refresh(lv_timer_t *timer) {
  (void)timer;
  hs_display_snapshot_t s;
  hs_display_snapshot(&s);
  tal_mutex_lock(lock);bool core_online=backend_connected;tal_mutex_unlock(lock);
  tal_mutex_lock(lock);bool checking=core_checking;hs_err_t check_error=core_check_error;tal_mutex_unlock(lock);
  if(!lv_obj_has_flag(core_panel,LV_OBJ_FLAG_HIDDEN)){
    lv_label_set_text(core_status,checking?"正在检查服务连接…":check_error==HS_ERR_INVALID_STATE?"设备正忙，请稍后重试":core_online?"服务已连接":check_error!=HS_OK?"服务未响应，请检查电脑服务":"服务尚未连接");
    if(checking)lv_obj_add_state(core_retry,LV_STATE_DISABLED);else lv_obj_remove_state(core_retry,LV_STATE_DISABLED);
  }
  if(core_online)lv_obj_add_flag(backend_offline,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(backend_offline,LV_OBJ_FLAG_HIDDEN);
  bool silent,proactive,listening;hs_t5_preferences(&silent,&proactive,&listening);
  if(!lv_obj_has_flag(settings_panel,LV_OBJ_FLAG_HIDDEN)){
    char line[220];snprintf(line,sizeof(line),"静默：%s   音量：%d%%\n主动招呼：%s   自动接话：%s\n手动接话始终可用",silent?"开":"关",hs_audio_volume_percent(),proactive?"开":"关",listening?"开":"关");lv_label_set_text(settings_status,line);
  }
  tal_mutex_lock(lock);bool active=session_listening;tal_mutex_unlock(lock);
  lv_label_set_text(session_title,active?"小冰正在听":"萌小冰的小院");
  if (s.revision != rendered) {
    lv_label_set_text(content, s.text);
    lv_obj_scroll_to_y(text_view,0,LV_ANIM_OFF);
    rendered = s.revision;
  }
  hs_wifi_status_t status;hs_wifi_status(&status);
  if(status.connected)lv_obj_add_flag(wifi_offline,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(wifi_offline,LV_OBJ_FLAG_HIDDEN);
  char connected[120];snprintf(connected,sizeof(connected),status.connected?"当前网络：%s":"当前未连接",status.ssid[0]?status.ssid:"正在读取");
  lv_label_set_text(wifi_current,connected);
  if(wifi_panel&&!lv_obj_has_flag(wifi_panel,LV_OBJ_FLAG_HIDDEN)&&wifi_revision!=status.revision){
    wifi_revision=status.revision;lv_obj_clean(wifi_list);
    visible_count=status.count>HS_WIFI_SCAN_LIMIT?HS_WIFI_SCAN_LIMIT:status.count;
    memcpy(visible_aps,status.aps,visible_count*sizeof(visible_aps[0]));
    for(unsigned i=0;i<visible_count;i++){
      char row[112];snprintf(row,sizeof(row),"%s%s",visible_aps[i].ssid,status.connected&&!strcmp(status.ssid,visible_aps[i].ssid)?"  已连接":"");
      lv_obj_t *b=lv_list_add_button(wifi_list,NULL,row);
      lv_obj_set_style_min_height(b,56,0);lv_obj_set_style_pad_ver(b,10,0);
      lv_obj_t *label=lv_obj_get_child(b,0);if(label){lv_obj_set_width(label,400);lv_label_set_long_mode(label,LV_LABEL_LONG_DOT);}
      lv_obj_add_event_cb(b,choose_wifi,LV_EVENT_CLICKED,(void *)(uintptr_t)i);
    }
    lv_label_set_text(wifi_message,status.message);
  }

}
hs_err_t hs_display_init(void) {
  if (tal_mutex_create_init(&lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  uint8_t *saved=NULL;size_t size=0;
  if(!tal_kv_get("hs.yard.prefs.v1",&saved,&size)&&size==sizeof(preferences)){
    preferences_t next;memcpy(&next,saved,size);if(next.version==1&&next.volume>=0&&next.volume<=100)preferences=next;
  }
  if(saved)tal_kv_free(saved);

  saved=NULL;size=0;
  if(!tal_kv_get("hs.avatar.v1",&saved,&size)&&size==sizeof(avatar_config)){avatar_config_t next;memcpy(&next,saved,size);if(next.version==1&&next.theme>=0&&next.theme<4&&(next.fullscreen==0||next.fullscreen==1))avatar_config=next;}
  if(saved)tal_kv_free(saved);
  saved=NULL;size=0;
  if(!tal_kv_get("hs.bear.color",&saved,&size)&&size==1&&saved[0]<4)sticker_color=saved[0];
  if(saved)tal_kv_free(saved);
  if (register_landscape() != HS_OK)
    return HS_FAIL;
  lv_vendor_init("homestash-t5-lcd");
  lv_obj_t *screen = lv_screen_active();
  if (!screen)
    return HS_FAIL;
  int width = lv_display_get_horizontal_resolution(NULL);
  int height = lv_display_get_vertical_resolution(NULL);
  if (width < 240 || height < 240)
    return HS_ERR_NOT_SUPPORTED;
  lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(screen, lv_color_hex(0xFFF6E9), 0);
  lv_obj_set_style_text_font(screen, &hs_yard_font, 0);
  lv_obj_set_style_text_color(screen, lv_color_hex(0x49382F), 0);
  wallpaper_view=lv_image_create(screen);
  lv_obj_remove_flag(wallpaper_view,LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_flag(wallpaper_view,LV_OBJ_FLAG_HIDDEN);
  session_title=lv_label_create(screen);lv_label_set_text(session_title,"萌小冰的小院");lv_obj_set_pos(session_title,12,8);
  lv_obj_set_style_text_font(session_title,&hs_yard_font,0);
  lv_obj_set_style_bg_color(session_title,lv_color_hex(0xFFF6E9),0);
  lv_obj_set_style_radius(session_title,8,0);
  lv_obj_set_style_pad_all(session_title,4,0);
  wifi_icon=button(screen,LV_SYMBOL_WIFI,width-100,2,44,show_wifi,NULL);
  button(screen,LV_SYMBOL_SETTINGS,width-50,2,44,show_settings,NULL);
  backend_icon=button(screen,LV_SYMBOL_UPLOAD,width-150,2,44,show_core,NULL);
  wifi_offline=offline_mark(wifi_icon);backend_offline=offline_mark(backend_icon);
  face=lv_obj_create(screen);lv_obj_remove_style_all(face);lv_obj_remove_flag(face,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_pad_all(face,0,0);lv_obj_set_style_border_width(face,0,0);
  for(int i=0;i<2;i++){
    eye[i]=avatar_part(face);lv_obj_add_event_cb(eye[i],avatar_heart,LV_EVENT_DRAW_MAIN,NULL);pupil[i]=avatar_part(eye[i]);shine[i]=avatar_part(pupil[i]);cheek[i]=avatar_part(face);brow[i]=avatar_part(face);
  }
  mouth=avatar_part(face);
  sticker_pixels=tal_psram_malloc(sticker_image_source.data_size);
  if(sticker_pixels){
    sticker_image_source.data=(const uint8_t *)sticker_pixels;
    memset(sticker_pixels,0,sticker_image_source.data_size);
    sticker_image=lv_image_create(face);
    lv_obj_remove_style_all(sticker_image);
    lv_image_set_src(sticker_image,&sticker_image_source);
    lv_obj_center(sticker_image);
    lv_obj_add_flag(sticker_image,LV_OBJ_FLAG_HIDDEN);
  }
  text_view=lv_obj_create(screen);lv_obj_set_pos(text_view,222,92);lv_obj_set_size(text_view,width-238,148);
  lv_obj_set_style_bg_color(text_view,lv_color_hex(0xFFFCF5),0);
  lv_obj_set_style_bg_opa(text_view,LV_OPA_COVER,0);
  lv_obj_set_style_border_color(text_view,lv_color_hex(0xE4C7AB),0);
  lv_obj_set_style_border_width(text_view,2,0);
  lv_obj_set_style_radius(text_view,18,0);
  lv_obj_set_style_pad_all(text_view,10,0);lv_obj_set_scroll_dir(text_view,LV_DIR_VER);
  lv_obj_set_scrollbar_mode(text_view,LV_SCROLLBAR_MODE_AUTO);
  content=lv_label_create(text_view);lv_obj_set_width(content,lv_pct(100));lv_obj_set_height(content,LV_SIZE_CONTENT);
  lv_obj_add_flag(content,LV_OBJ_FLAG_SCROLL_CHAIN_VER);
  lv_label_set_long_mode(content,LV_LABEL_LONG_WRAP);lv_label_set_text(content,"正在醒来，请稍候。");
  lv_obj_t *wake=button(screen,"唤醒",8,264,112,clicked,(void *)(intptr_t)2);
  lv_obj_t *photo=button(screen,"拍照",125,264,112,clicked,(void *)(intptr_t)3);
  lv_obj_t *memory=button(screen,"回忆",242,264,112,gallery_open,NULL);
  photos_button=button(screen,"照片",359,264,112,gallery_open,(void *)1);
  lv_obj_t *actions[]={wake,photo,memory,photos_button};
  for(unsigned i=0;i<sizeof(actions)/sizeof(actions[0]);i++)
    lv_obj_set_style_text_font(lv_obj_get_child(actions[i],0),&hs_yard_font,0);
  avatar_toggle=button(screen,"",158,46,44,avatar_toggle_click,NULL);
  lv_obj_set_style_text_font(lv_obj_get_child(avatar_toggle,0),&lv_font_montserrat_14,0);
  lv_obj_add_event_cb(avatar_toggle,fullscreen_icon,LV_EVENT_DRAW_MAIN_END,NULL);
  avatar_stop=button(screen,LV_SYMBOL_STOP,106,46,44,clicked,(void *)(intptr_t)5);
  avatar_color=button(screen,LV_SYMBOL_TINT,54,46,44,avatar_color_click,NULL);
  lv_obj_set_style_text_font(lv_obj_get_child(avatar_color,0),&lv_font_montserrat_14,0);
  lv_obj_t *controls[]={avatar_toggle,avatar_stop,avatar_color};
  for(unsigned i=0;i<sizeof(controls)/sizeof(controls[0]);i++){lv_obj_set_style_radius(controls[i],22,0);lv_obj_set_style_bg_color(controls[i],lv_color_hex(i?0xFBE7EA:0xEDF3F1),0);lv_obj_set_style_text_color(controls[i],lv_color_hex(i?0xA03C53:0x365E58),0);lv_obj_set_style_shadow_width(controls[i],0,0);}
  lv_obj_add_flag(avatar_stop,LV_OBJ_FLAG_HIDDEN);
  avatar_status=lv_label_create(screen);lv_obj_set_style_text_font(avatar_status,&hs_yard_font,0);lv_obj_set_pos(avatar_status,16,14);lv_obj_add_flag(avatar_status,LV_OBJ_FLAG_HIDDEN);
  avatar_base_children=lv_obj_get_child_count(screen);
  photo_preview_panel=lv_obj_create(screen);
  lv_obj_set_size(photo_preview_panel,width,height);
  lv_obj_set_style_pad_all(photo_preview_panel,0,0);
  lv_obj_set_style_border_width(photo_preview_panel,0,0);
  lv_obj_set_style_bg_color(photo_preview_panel,lv_color_hex(0xFFF6E9),0);
  lv_obj_remove_flag(photo_preview_panel,LV_OBJ_FLAG_SCROLLABLE);
  photo_preview_view=lv_image_create(photo_preview_panel);
  lv_obj_align(photo_preview_view,LV_ALIGN_TOP_MID,0,10);
  photo_preview_empty=lv_label_create(photo_preview_panel);
  lv_label_set_text(photo_preview_empty,"还没有照片");
  lv_obj_center(photo_preview_empty);
  button(photo_preview_panel,"返回",12,264,112,photo_preview_close,NULL);
  button(photo_preview_panel,"生成回忆",148,264,128,gallery_generate_click,(void *)1);
  photo_preview_wallpaper=button(photo_preview_panel,"设为壁纸",width-136,264,124,photo_preview_set_wallpaper,(void *)(intptr_t)24);
  lv_obj_add_flag(photo_preview_wallpaper,LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(photo_preview_panel,LV_OBJ_FLAG_HIDDEN);

  gallery_panel = lv_obj_create(screen);
  lv_obj_set_size(gallery_panel, width, height);
  lv_obj_set_style_pad_all(gallery_panel, 0, 0);
  lv_obj_set_style_border_width(gallery_panel, 0, 0);
  lv_obj_set_style_radius(gallery_panel, 0, 0);
  lv_obj_set_style_bg_color(gallery_panel, lv_color_hex(0xFFF6E9), 0);
  lv_obj_remove_flag(gallery_panel, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_add_event_cb(gallery_panel, gallery_gesture, LV_EVENT_GESTURE, NULL);
  gallery_title = lv_label_create(gallery_panel);
  lv_obj_align(gallery_title, LV_ALIGN_TOP_MID, 0, 16);
  gallery_story = lv_label_create(gallery_panel);
  lv_obj_set_pos(gallery_story, 265, 50);
  lv_obj_set_size(gallery_story, width - 275, 210);
  lv_label_set_long_mode(gallery_story, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_line_space(gallery_story, -5, 0);
  gallery_view = lv_image_create(gallery_panel);
  lv_obj_add_flag(gallery_view, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_add_event_cb(gallery_view, gallery_image_click, LV_EVENT_CLICKED, NULL);
  button(gallery_panel, "返回", 12, 264, 88, gallery_back, NULL);
  gallery_prev = button(gallery_panel, LV_SYMBOL_LEFT, width - 120, 264, 48, gallery_turn_click, (void *)(intptr_t)-1);
  gallery_next = button(gallery_panel, LV_SYMBOL_RIGHT, width - 60, 264, 48, gallery_turn_click, (void *)(intptr_t)1);
  gallery_latest = button(gallery_panel, "刚拍的照片", 110, 264, 140, gallery_latest_click, NULL);
  gallery_generate = button(gallery_panel, "生成回忆", 252, 264, 104, gallery_generate_click, NULL);
  gallery_retry = button(gallery_panel, "重试", 260, 264, 86, gallery_retry_click, NULL);
  lv_obj_add_flag(gallery_panel, LV_OBJ_FLAG_HIDDEN);

  wifi_panel=lv_obj_create(screen);lv_obj_set_size(wifi_panel,width,height);lv_obj_set_pos(wifi_panel,0,0);
  lv_obj_set_style_pad_all(wifi_panel,8,0);lv_obj_remove_flag(wifi_panel,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_bg_color(wifi_panel,lv_color_hex(0xFFF6E9),0);
  button(wifi_panel,"返回",0,0,88,close_wifi,NULL);button(wifi_panel,"扫描",width-128,0,104,scan_wifi,NULL);
  lv_obj_t *wifi_title=lv_label_create(wifi_panel);lv_label_set_text(wifi_title,"选择网络");lv_obj_set_pos(wifi_title,150,6);
  wifi_current=lv_label_create(wifi_panel);lv_obj_set_pos(wifi_current,0,54);lv_obj_set_width(wifi_current,width-24);lv_label_set_long_mode(wifi_current,LV_LABEL_LONG_SCROLL_CIRCULAR);
  wifi_message=lv_label_create(wifi_panel);lv_obj_set_pos(wifi_message,0,88);lv_obj_set_width(wifi_message,width-24);lv_label_set_long_mode(wifi_message,LV_LABEL_LONG_DOT);lv_label_set_text(wifi_message,"点击网络，进入密码页面");
  wifi_list=lv_list_create(wifi_panel);lv_obj_set_pos(wifi_list,0,124);lv_obj_set_size(wifi_list,width-24,height-144);
  lv_obj_set_style_pad_all(wifi_list,4,0);lv_obj_set_style_pad_row(wifi_list,8,0);
  lv_obj_add_flag(wifi_panel,LV_OBJ_FLAG_HIDDEN);
  password_panel=lv_obj_create(screen);lv_obj_set_size(password_panel,width,height);lv_obj_set_pos(password_panel,0,0);lv_obj_set_style_pad_all(password_panel,8,0);lv_obj_set_style_border_width(password_panel,0,0);lv_obj_remove_flag(password_panel,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_bg_color(password_panel,lv_color_hex(0xFFF6E9),0);
  button(password_panel,"返回",0,0,88,back_to_networks,NULL);button(password_panel,"连接保存",width-160,0,136,connect_wifi,NULL);
  password_network=lv_label_create(password_panel);lv_obj_set_pos(password_network,104,6);lv_obj_set_width(password_network,width-278);lv_label_set_long_mode(password_network,LV_LABEL_LONG_SCROLL_CIRCULAR);
  password=lv_textarea_create(password_panel);lv_obj_set_pos(password,0,60);lv_obj_set_size(password,width-128,56);
  lv_textarea_set_one_line(password,true);lv_textarea_set_password_mode(password,true);lv_textarea_set_max_length(password,64);lv_textarea_set_placeholder_text(password,"输入网络密码");
  lv_obj_add_event_cb(password,show_password_keyboard,LV_EVENT_CLICKED,NULL);
  lv_obj_add_event_cb(password,show_password_keyboard,LV_EVENT_FOCUSED,NULL);
  password_visibility=button(password_panel,"显示",width-120,64,96,toggle_password,NULL);
  password_note=lv_label_create(password_panel);lv_obj_set_pos(password_note,0,122);lv_obj_set_width(password_note,width-24);lv_label_set_long_mode(password_note,LV_LABEL_LONG_DOT);
  keyboard=lv_keyboard_create(password_panel);lv_obj_set_size(keyboard,width-24,144);lv_obj_align(keyboard,LV_ALIGN_TOP_LEFT,0,160);
  lv_obj_add_event_cb(keyboard,password_keyboard_event,LV_EVENT_READY,NULL);
  lv_obj_add_event_cb(keyboard,password_keyboard_event,LV_EVENT_CANCEL,NULL);
  lv_obj_set_style_text_font(keyboard,&lv_font_montserrat_14,LV_PART_ITEMS);lv_keyboard_set_textarea(keyboard,password);
  lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
  settings_panel=lv_obj_create(screen);lv_obj_set_size(settings_panel,width,height);lv_obj_set_pos(settings_panel,0,0);lv_obj_set_style_pad_all(settings_panel,8,0);
  button(settings_panel,"返回",0,0,80,close_settings,NULL);
  settings_status=lv_label_create(settings_panel);lv_obj_set_pos(settings_status,0,52);lv_obj_set_width(settings_status,width-24);
  button(settings_panel,"静默",0,160,140,preference_click,(void *)(intptr_t)0);
  button(settings_panel,"主动招呼",148,160,144,preference_click,(void *)(intptr_t)1);
  button(settings_panel,"自动接话",300,160,144,preference_click,(void *)(intptr_t)2);
  button(settings_panel,"音量减",0,218,140,preference_click,(void *)(intptr_t)3);
  button(settings_panel,"音量加",148,218,144,preference_click,(void *)(intptr_t)4);
  lv_obj_add_flag(settings_panel,LV_OBJ_FLAG_HIDDEN);
  core_panel=lv_obj_create(screen);lv_obj_set_size(core_panel,width,height);lv_obj_set_pos(core_panel,0,0);lv_obj_set_style_pad_all(core_panel,8,0);
  button(core_panel,"返回",0,0,80,close_core,NULL);
  lv_obj_t *core_title=lv_label_create(core_panel);lv_label_set_text(core_title,"服务连接");lv_obj_set_pos(core_title,190,8);
  core_status=lv_label_create(core_panel);lv_obj_set_pos(core_status,0,62);lv_obj_set_size(core_status,width-24,64);lv_label_set_long_mode(core_status,LV_LABEL_LONG_WRAP);
  core_address=lv_label_create(core_panel);lv_obj_set_pos(core_address,0,140);lv_obj_set_width(core_address,width-24);lv_label_set_long_mode(core_address,LV_LABEL_LONG_SCROLL_CIRCULAR);
  core_retry=button(core_panel,"重新检查",0,204,160,retry_core,NULL);
  lv_obj_t *core_hint=lv_label_create(core_panel);lv_label_set_text(core_hint,"请与电脑连接同一网络");lv_obj_set_pos(core_hint,0,264);
  lv_obj_add_flag(core_panel,LV_OBJ_FLAG_HIDDEN);
  lv_timer_create(refresh, 100, NULL);
  lv_timer_create(avatar_tick,50,NULL);
  lv_vendor_start(5, 8192);
  HS_LOGI("display", "pet resolution=%dx%d", width, height);
  return HS_OK;
}
void hs_display_text(const char *text) {
  tal_mutex_lock(lock);
  snprintf(snapshot.text, sizeof(snapshot.text), "%s", text ? text : "");
  snapshot.revision++;
  tal_mutex_unlock(lock);
}
void hs_display_network(const char *ssid, bool connected) {
  tal_mutex_lock(lock);
  char next[96];
  snprintf(next, sizeof(next), connected ? "已连接：%s" : "网络未连接",
           ssid ? ssid : "");
  if (strcmp(next, snapshot.network)) {
    snprintf(snapshot.network, sizeof(snapshot.network), "%s", next);
    snapshot.revision++;
  }
  tal_mutex_unlock(lock);
}
void hs_display_snapshot(hs_display_snapshot_t *out) {
  tal_mutex_lock(lock);
  *out = snapshot;
  tal_mutex_unlock(lock);
}
void hs_display_navigation(void (*callback)(int)) {
  tal_mutex_lock(lock);
  navigate = callback;
  tal_mutex_unlock(lock);
}
void hs_display_select_page(int page) {
  tal_mutex_lock(lock);
  if (page >= 0 && page < 6)
    selected = page;
  tal_mutex_unlock(lock);
}
hs_err_t hs_display_backlight(bool enabled) {
  (void)enabled;
  return HS_ERR_NOT_SUPPORTED;
}
hs_err_t hs_display_suspend(void) { return HS_ERR_NOT_SUPPORTED; }
hs_err_t hs_display_resume(void) { return HS_ERR_NOT_SUPPORTED; }
void hs_display_backend(bool connected) { tal_mutex_lock(lock);backend_connected=connected;tal_mutex_unlock(lock); }
void hs_display_dialogue(int state) { if(state<0||state>HS_FACE_ERROR)return;tal_mutex_lock(lock);if(avatar_state!=state){avatar_state=state;avatar_epoch=lv_tick_get();}tal_mutex_unlock(lock); }
