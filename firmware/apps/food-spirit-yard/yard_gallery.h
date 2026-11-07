#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    unsigned revision;
    unsigned index;
    bool photos;
    bool generate;
    char anchor[37];
} yard_gallery_request_t;

typedef struct {
    unsigned index;
    unsigned count;
    char id[37];
    char date[11];
    char story[320];
} yard_gallery_page_t;

bool hs_t5_gallery_take_request(yard_gallery_request_t *request);
void hs_t5_gallery_result(unsigned revision, const yard_gallery_page_t *page,
                          const uint8_t *jpeg, size_t length);
void hs_transport_yard_gallery(const yard_gallery_request_t *request);
