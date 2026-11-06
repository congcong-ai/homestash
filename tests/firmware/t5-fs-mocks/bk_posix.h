#pragma once
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <stdio.h>
typedef struct {void *dir_data;} bk_dir;
int hs_test_stat(const char *path,struct stat *out);
#define stat(path,out) hs_test_stat(path,out)
